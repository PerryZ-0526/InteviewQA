import { parseDocument, stringify } from 'yaml';

export const QUESTION_BODY_SCHEMA = 'interviewqa/sections-v1';

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const PRIORITY_KEYS = ['schema', 'kind', 'body_schema', 'title', 'tags', 'created', 'updated'];
const SECTION_TYPES = new Map([
  ['题目', 'question'],
  ['面试直接答', 'answer'],
  ['详细解析', 'analysis'],
  ['我的作答', 'notes'],
]);

function parseEnvelope(markdown) {
  const match = markdown.replace(/^\uFEFF/, '').match(FRONTMATTER_RE);
  if (!match) throw new Error('缺少 YAML frontmatter');
  const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`YAML frontmatter 解析失败: ${document.errors[0].message}`);
  }
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('YAML frontmatter 必须是对象');
  }
  let body = markdown.replace(/^\uFEFF/, '').slice(match[0].length);
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);
  return { attributes: value, body };
}

function trimBoundaryBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

function splitHeadingSections(body) {
  const preamble = [];
  const sections = new Map([
    ['question', []],
    ['answer', []],
    ['analysis', []],
    ['notes', []],
  ]);
  const seen = new Set();
  let current = null;
  let inCodeBlock = false;

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      (current ? sections.get(current) : preamble).push(line);
      continue;
    }
    const heading = !inCodeBlock ? line.match(/^##\s+(.+?)\s*$/) : null;
    const nextType = heading ? SECTION_TYPES.get(heading[1]) : null;
    if (nextType) {
      if (seen.has(nextType)) throw new Error(`标准章节重复: ${heading[1]}`);
      seen.add(nextType);
      current = nextType;
      continue;
    }
    (current ? sections.get(current) : preamble).push(line);
  }

  if (seen.size === 0) {
    sections.set('analysis', [...preamble]);
    preamble.length = 0;
  }

  return {
    preamble: trimBoundaryBlankLines(preamble),
    question: trimBoundaryBlankLines(sections.get('question')),
    answer: trimBoundaryBlankLines(sections.get('answer')),
    analysis: trimBoundaryBlankLines(sections.get('analysis')),
    notes: trimBoundaryBlankLines(sections.get('notes')),
  };
}

function markerBlock(type, content) {
  return content
    ? `<!-- interviewqa:section ${type} -->\n${content}\n<!-- interviewqa:end -->`
    : `<!-- interviewqa:section ${type} -->\n<!-- interviewqa:end -->`;
}

function serializeBody(parts) {
  const blocks = [];
  if (parts.preamble) blocks.push(parts.preamble);
  blocks.push(markerBlock('question', parts.question));
  blocks.push(markerBlock('answer', parts.answer));
  blocks.push(markerBlock('analysis', parts.analysis));
  if (parts.notes) blocks.push(markerBlock('notes', parts.notes));
  return `${blocks.join('\n\n')}\n`;
}

function serializeDocument(attributes, body) {
  const ordered = {};
  for (const key of PRIORITY_KEYS) {
    if (attributes[key] !== undefined) ordered[key] = attributes[key];
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!PRIORITY_KEYS.includes(key) && value !== undefined) ordered[key] = value;
  }
  const yaml = stringify(ordered, { lineWidth: 0, minContentWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}

export function migrateQuestionSections(markdown) {
  const parsed = parseEnvelope(markdown);
  if (parsed.attributes.schema !== 'interviewqa/v2' || parsed.attributes.kind !== 'question') {
    throw new Error('只支持 interviewqa/v2 question 文档');
  }
  if (parsed.attributes.body_schema === QUESTION_BODY_SCHEMA) {
    return { changed: false, content: markdown };
  }

  const sections = splitHeadingSections(parsed.body);
  return {
    changed: true,
    content: serializeDocument(
      { ...parsed.attributes, body_schema: QUESTION_BODY_SCHEMA },
      serializeBody(sections),
    ),
    sections,
  };
}
