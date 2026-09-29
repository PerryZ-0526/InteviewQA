function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

export function parseMarkdownDocument(md) {
  const normalized = md.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { attributes: {}, body: normalized, isV2: false };

  const attributes = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const field = lines[index].match(/^([A-Za-z][\w-]*):(?:\s*(.*))?$/);
    if (!field) continue;
    const [, key, rawValue = ''] = field;
    if (rawValue.trim()) {
      attributes[key] = parseYamlScalar(rawValue);
      continue;
    }
    const values = [];
    while (index + 1 < lines.length) {
      const item = lines[index + 1].match(/^\s+-\s*(.*)$/);
      if (!item) break;
      values.push(parseYamlScalar(item[1]));
      index++;
    }
    attributes[key] = values;
  }

  let body = normalized.slice(match[0].length);
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);
  return {
    attributes,
    body,
    isV2: attributes.schema === 'interviewqa/v2',
  };
}

export function documentTitle(md, fallback = '') {
  const document = parseMarkdownDocument(md);
  if (document.isV2 && typeof document.attributes.title === 'string' && document.attributes.title.trim()) {
    return document.attributes.title.trim();
  }
  const firstContent = document.body.split(/\r?\n/).find((line) => line.trim());
  return firstContent?.match(/^#\s+(.+)/)?.[1]?.trim()
    || (typeof document.attributes.title === 'string' ? document.attributes.title.trim() : '')
    || fallback;
}

const QUESTION_BODY_SCHEMA = 'interviewqa/sections-v1';
const FREEFORM_BODY_SCHEMA = 'interviewqa/freeform-v1';
const SECTION_START_RE = /^<!-- interviewqa:section (question|answer|analysis|notes)(?: .*?)? -->$/;
const SECTION_END_MARKER = '<!-- interviewqa:end -->';

function parseMarkerSections(body) {
  const sections = { question: '', answer: '', analysis: '', notes: '' };
  let current = '';
  let inCodeBlock = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (current) sections[current] += `${line}\n`;
      continue;
    }
    if (!inCodeBlock) {
      const start = line.trim().match(SECTION_START_RE);
      if (start) {
        current = start[1];
        continue;
      }
      if (line.trim() === SECTION_END_MARKER) {
        current = '';
        continue;
      }
    }
    if (current) sections[current] += `${line}\n`;
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [key, value.trim()]),
  );
}

export function parseQuestion(md, filename) {
  const document = parseMarkdownDocument(md);
  if (document.isV2 && document.attributes.body_schema === QUESTION_BODY_SCHEMA) {
    const sections = parseMarkerSections(document.body);
    const tags = Array.isArray(document.attributes.tags)
      ? document.attributes.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim())
      : [];
    return {
      title: typeof document.attributes.title === 'string'
        ? document.attributes.title.trim()
        : filename.replace(/^\d{3}-/, '').replace(/\.md$/, ''),
      question: sections.question,
      tags: [...new Set(tags)],
      answer: sections.answer,
      analysis: sections.analysis,
      notes: sections.notes,
      filename,
    };
  }
  const lines = document.body.split('\n');
  const titleLineIndex = lines.findIndex((line) => line.trim().length > 0);
  let title = document.isV2 && typeof document.attributes.title === 'string'
    ? document.attributes.title.trim()
    : '';
  let question = '';
  let answer = '';
  let analysis = '';
  let notes = '';
  const tagNames = document.isV2 && Array.isArray(document.attributes.tags)
    ? document.attributes.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim())
    : [];
  const knownSections = new Set(['题目', '标签', '题目导航', '面试直接答', '详细解析', '我的作答']);
  let section = '';
  let inCodeBlock = false;

  for (const [lineIndex, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
    }
    if (!document.isV2 && !inCodeBlock && lineIndex === titleLineIndex && line.startsWith('# ')) {
      title = line.slice(2).trim();
      continue;
    }
    if (!inCodeBlock && line.startsWith('## ')) {
      const name = line.slice(3).trim();
      section = knownSections.has(name) ? name : '';
      continue;
    }
    switch (section) {
      case '题目':
        if (line.trim() || question) question += `${line}\n`;
        break;
      case '标签': {
        const matches = line.match(/\[([^\]]+)\]\([^)]+\)/g);
        matches?.forEach((match) => {
          const name = match.match(/\[([^\]]+)\]/)?.[1];
          if (name) tagNames.push(name);
        });
        break;
      }
      case '面试直接答':
        if (line.trim() || answer) answer += `${line}\n`;
        break;
      case '详细解析':
        if (!/<!--\s*(?:created|updated):/.test(line) && (line.trim() || analysis)) analysis += `${line}\n`;
        break;
      case '我的作答':
        if (!/<!--\s*(?:created|updated):/.test(line) && (line.trim() || notes)) notes += `${line}\n`;
        break;
    }
  }

  return {
    title: title || filename.replace(/^\d{3}-/, '').replace(/\.md$/, ''),
    question: question.trim(),
    tags: [...new Set(tagNames)],
    answer: answer.trim(),
    analysis: analysis.trim(),
    notes: notes.trim(),
    filename,
  };
}

export function parseCategoryDocument(md, filename) {
  const document = parseMarkdownDocument(md);
  if (
    document.isV2
    && document.attributes.kind === 'document'
    && document.attributes.body_schema === FREEFORM_BODY_SCHEMA
  ) {
    const tags = Array.isArray(document.attributes.tags)
      ? document.attributes.tags
          .filter((tag) => typeof tag === 'string' && tag.trim())
          .map((tag) => tag.trim())
      : [];
    return {
      kind: 'document',
      title: documentTitle(md, filename.replace(/^\d{3}-/, '').replace(/\.md$/, '')),
      question: document.body,
      body: document.body,
      tags: [...new Set(tags)],
      answer: '',
      analysis: '',
      notes: '',
      filename,
    };
  }
  return { ...parseQuestion(md, filename), kind: 'question', body: '' };
}

export function parseIndex(md) {
  const docs = [];
  for (const line of md.split('\n')) {
    const match = line.match(/- \[([^\]]+)\]\(([^)]+\.md)\)(?:\s*-\s*(.*))?/);
    if (match) {
      docs.push({ title: match[1], filename: match[2], brief: match[3] || '' });
    }
  }
  return docs;
}
