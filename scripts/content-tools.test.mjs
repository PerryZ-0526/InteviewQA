import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContentManifest } from '../mobile/scripts/content-manifest.mjs';
import { parseQuestion } from '../mobile/src/content.js';

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

test('generated mobile manifest contains repository content', () => {
  const manifest = buildContentManifest(root);
  assert.equal(manifest.version, 1);
  assert.ok(manifest.categories.length > 0);
  assert.ok(manifest.categories.some((category) => category.slug === 'agent'));
  const questions = manifest.categories.flatMap((category) => category.questions);
  assert.ok(questions.length > 0);
  assert.equal('answer' in questions[0], false);
  assert.equal('content' in manifest.projectDocs[0], false);
});
