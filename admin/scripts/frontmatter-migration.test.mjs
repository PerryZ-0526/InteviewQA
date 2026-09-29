import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { migrateMarkdown } from './frontmatter-migration.mjs';

const fallbackTimes = {
  createdFallback: '2026-09-01 10:00:00',
  updatedFallback: '2026-09-02 11:00:00',
};

function splitV2(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  assert.ok(match);
  return {
    attributes: parseDocument(match[1]).toJS(),
    body: match[2],
  };
}

test('category migration moves metadata and preserves body headings', () => {
  const source = `---
status: draft
owner:
  team: knowledge
---

# 文档标题

开场内容

## 题目

问题正文

# 正文一级标题

正文内容

## 标签

[Agent](../../tags/Agent.md) | [RAG](../../tags/RAG.md)

## 题目导航

← 无 | 无 →

## 详细解析

最后一行<!-- created: 2026-08-01 01:02:03 -->
<!-- updated: 2026-08-02 02:03:04 -->
`;

  const migrated = migrateMarkdown(source, {
    kind: 'question',
    fallbackTitle: 'fallback',
    ...fallbackTimes,
  });
  assert.equal(migrated.changed, true);

  const parsed = splitV2(migrated.content);
  assert.equal(parsed.attributes.schema, 'interviewqa/v2');
  assert.equal(parsed.attributes.kind, 'question');
  assert.equal(parsed.attributes.title, '文档标题');
  assert.deepEqual(parsed.attributes.tags, ['Agent', 'RAG']);
  assert.equal(parsed.attributes.created, '2026-08-01 01:02:03');
  assert.equal(parsed.attributes.updated, '2026-08-02 02:03:04');
  assert.deepEqual(parsed.attributes.owner, { team: 'knowledge' });
  assert.match(parsed.body, /^开场内容/);
  assert.match(parsed.body, /# 正文一级标题/);
  assert.match(parsed.body, /最后一行/);
  assert.doesNotMatch(parsed.body, /^# 文档标题$/m);
  assert.doesNotMatch(parsed.body, /^## (标签|题目导航)$/m);
  assert.doesNotMatch(parsed.body, /<!--\s*(created|updated):/);
});

test('migration is idempotent', () => {
  const first = migrateMarkdown('# 标题\n\n## 题目\n\n正文\n', {
    kind: 'question',
    fallbackTitle: 'fallback',
    ...fallbackTimes,
  });
  const second = migrateMarkdown(first.content, {
    kind: 'question',
    fallbackTitle: 'fallback',
    ...fallbackTimes,
  });
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});
