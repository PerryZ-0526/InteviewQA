import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { migrateQuestionSections } from './section-marker-migration.mjs';
import { parseQuestion } from '../../mobile/src/content.js';

function splitDocument(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  assert.ok(match);
  return { attributes: parseDocument(match[1]).toJS(), body: match[2] };
}

test('section migration marks standard sections and keeps nested H2 content', () => {
  const source = `---
schema: interviewqa/v2
kind: question
title: 标题
tags:
  - Agent
created: 2026-09-01 10:00:00
updated: 2026-09-02 10:00:00
---

前言

## 题目

问题

## 面试直接答

答案

## 详细解析

### 原理

内容

## 普通二级标题

仍属于详细解析
`;
  const migrated = migrateQuestionSections(source);
  const parsed = splitDocument(migrated.content);
  assert.equal(parsed.attributes.body_schema, 'interviewqa/sections-v1');
  assert.match(parsed.body, /<!-- interviewqa:section question -->/);
  assert.match(parsed.body, /<!-- interviewqa:section answer -->/);
  assert.match(parsed.body, /<!-- interviewqa:section analysis -->/);
  assert.match(parsed.body, /## 普通二级标题/);

  const question = parseQuestion(migrated.content, '001-test.md');
  assert.equal(question.question, '问题');
  assert.equal(question.answer, '答案');
  assert.match(question.analysis, /## 普通二级标题/);
  assert.match(question.analysis, /仍属于详细解析/);
});

test('free-form question documents become one analysis section', () => {
  const source = `---
schema: interviewqa/v2
kind: question
title: 自由文档
tags: []
created: 2026-09-01 10:00:00
updated: 2026-09-02 10:00:00
---

# 一级标题

## 二级标题

正文
`;
  const migrated = migrateQuestionSections(source);
  const question = parseQuestion(migrated.content, '001-test.md');
  assert.equal(question.question, '');
  assert.equal(question.answer, '');
  assert.equal(question.analysis, '# 一级标题\n\n## 二级标题\n\n正文');
});

test('section migration is idempotent', () => {
  const source = `---
schema: interviewqa/v2
kind: question
title: 标题
tags: []
created: 2026-09-01 10:00:00
updated: 2026-09-02 10:00:00
---

## 题目

问题
`;
  const first = migrateQuestionSections(source);
  const second = migrateQuestionSections(first.content);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});
