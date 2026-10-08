import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContentManifest } from '../mobile/scripts/content-manifest.mjs';
import { createSyncManifest } from '../mobile/scripts/sync-manifest.mjs';
import { parseCategoryDocument, parseQuestion } from '../mobile/src/content.js';
import { groupLibraryDocuments } from '../mobile/src/library.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('question parser ignores headings inside code fences', () => {
  const parsed = parseQuestion(`# 标题

## 题目

问题

## 标签

[Agent](../../tags/Agent.md)

## 面试直接答

\`\`\`md
## 不是新章节
\`\`\`
答案
`, '001-test.md');

  assert.equal(parsed.title, '标题');
  assert.deepEqual(parsed.tags, ['Agent']);
  assert.match(parsed.answer, /不是新章节/);
  assert.match(parsed.answer, /答案/);
});

test('question parser preserves H1 headings after the document title', () => {
  const parsed = parseQuestion(`
# 文档标题

## 面试直接答

# 正文一级标题

正文内容
`, '001-test.md');

  assert.equal(parsed.title, '文档标题');
  assert.equal(parsed.answer, '# 正文一级标题\n\n正文内容');
});

test('question parser reads v2 metadata without consuming body H1 headings', () => {
  const parsed = parseQuestion(`---
schema: interviewqa/v2
kind: question
title: Frontmatter 标题
tags:
  - Agent
  - RAG
created: "2026-09-23 10:00:00"
updated: "2026-09-23 11:00:00"
---

## 题目

问题

## 面试直接答

# 正文一级标题

答案
`, '001-test.md');

  assert.equal(parsed.title, 'Frontmatter 标题');
  assert.deepEqual(parsed.tags, ['Agent', 'RAG']);
  assert.equal(parsed.answer, '# 正文一级标题\n\n答案');
});

test('category document parser keeps freeform markdown as one body', () => {
  const parsed = parseCategoryDocument(`---
schema: interviewqa/v2
kind: document
body_schema: interviewqa/freeform-v1
title: 自由文档
tags:
  - Agent
created: 2026-09-24 10:00:00
updated: 2026-09-24 10:00:00
---

# 任意正文标题

正文内容
`, '001-freeform.md');

  assert.equal(parsed.kind, 'document');
  assert.equal(parsed.title, '自由文档');
  assert.deepEqual(parsed.tags, ['Agent']);
  assert.equal(parsed.body, '# 任意正文标题\n\n正文内容\n');
  assert.equal(parsed.analysis, '');
});

test('generated mobile manifest contains repository content', () => {
  const manifest = buildContentManifest(root);
  assert.equal(manifest.version, 1);
  assert.ok(manifest.categories.length > 0);
  assert.ok(manifest.categories.some((category) => category.slug === 'agent'));
  const questions = manifest.categories.flatMap((category) => category.questions);
  assert.ok(questions.length > 0);
  assert.ok(questions.every((document) => ['question', 'document'].includes(document.kind)));
  assert.equal('answer' in questions[0], false);
  assert.equal('content' in manifest.projectDocs[0], false);

  const projectDirectories = groupLibraryDocuments(manifest.projectDocs, 'project');
  const customGroups = groupLibraryDocuments(manifest.projectDocs, 'groups');
  assert.ok(projectDirectories.some((directory) => directory.name === 'TJ-Edu-Agent'));
  assert.ok(customGroups.some((directory) => directory.name === 'Claude Code Docs'));
  assert.equal(
    projectDirectories.flatMap((directory) => directory.documents).length,
    manifest.projectDocs.filter((document) => document.base === 'project').length,
  );
  assert.equal(
    customGroups.flatMap((directory) => directory.documents).length,
    manifest.projectDocs.filter((document) => document.base === 'groups').length,
  );
});

test('sync manifest hashes generated index and content files', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'interviewqa-sync-'));
  try {
    fs.mkdirSync(path.join(fixture, 'categories', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'content-manifest.json'), '{"version":1}', 'utf8');
    fs.writeFileSync(path.join(fixture, 'categories', 'demo', '001-test.md'), '# Test', 'utf8');
    const manifest = createSyncManifest(fixture, {
      contentVersion: 'abc123',
      generatedAt: '2026-10-08T00:00:00.000Z',
    });
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.contentVersion, 'abc123');
    assert.deepEqual(
      manifest.files.map((entry) => entry.path),
      ['categories/demo/001-test.md', 'content-manifest.json'],
    );
    assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
