import { parseDocument, stringify } from 'yaml';

export const DOCUMENT_SCHEMA = 'interviewqa/v2';

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const TIME_COMMENT_RE = /<!--\s*(created|updated):\s*(.+?)\s*-->/g;
const PRIORITY_KEYS = ['schema', 'kind', 'title', 'tags', 'created', 'updated'];

function parseEnvelope(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) return { attributes: {}, body: normalized };

  const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`YAML frontmatter 解析失败: ${document.errors[0].message}`);
  }
  const value = document.toJS();
  const attributes = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  let body = normalized.slice(match[0].length);
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);
  return { attributes, body };
}

function yamlScalarString(attributes, key) {
  return typeof attributes[key] === 'string' ? attributes[key].trim() : '';
}

function yamlStringList(attributes, key) {
  const value = attributes[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanTitle(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .trim();
}

function serialize(attributes, body) {
  const ordered = {};
  for (const key of PRIORITY_KEYS) {
    if (attributes[key] !== undefined) ordered[key] = attributes[key];
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!PRIORITY_KEYS.includes(key) && value !== undefined) ordered[key] = value;
  }
  const yaml = stringify(ordered, { lineWidth: 0, minContentWidth: 0 }).trimEnd();
  const envelope = `---\n${yaml}\n---\n`;
  return body ? `${envelope}\n${body}` : envelope;
}

function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

function extractLegacyBody(body, kind) {
  const lines = body.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim());
  let title = '';
  if (firstContentIndex >= 0) {
    const titleMatch = lines[firstContentIndex].match(/^#\s+(.+)/);
    if (titleMatch) {
      title = cleanTitle(titleMatch[1]);
      lines.splice(firstContentIndex, 1);
    }
  }

  const kept = [];
  const tags = [];
  const times = {};
  let inCodeBlock = false;
  let removedSection = '';

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (!removedSection) kept.push(line);
      continue;
    }

    const heading = !inCodeBlock ? line.match(/^##\s+(.+?)\s*$/) : null;
    if (heading) {
      if (kind === 'question' && (heading[1] === '标签' || heading[1] === '题目导航')) {
        removedSection = heading[1];
        continue;
      }
      removedSection = '';
    }

    let hadTimeComment = false;
    const cleaned = line.replace(TIME_COMMENT_RE, (_match, key, value) => {
      hadTimeComment = true;
      times[key] = String(value).trim();
      return '';
    }).replace(/[ \t]+$/, '');

    if (removedSection) {
      if (removedSection === '标签') {
        for (const match of cleaned.matchAll(/\[([^\]]+)\]\([^)]+\)/g)) tags.push(match[1].trim());
      }
      continue;
    }

    if (!hadTimeComment || cleaned.trim()) kept.push(cleaned);
  }

  const contentLines = trimOuterBlankLines(kept);
  return {
    title,
    tags: [...new Set(tags.filter(Boolean))],
    created: times.created || '',
    updated: times.updated || '',
    body: contentLines.length > 0 ? `${contentLines.join('\n')}\n` : '',
  };
}

/**
 * 将单篇旧文档迁移到 v2。函数无文件系统副作用，便于 dry-run 和回归测试。
 */
export function migrateMarkdown(markdown, options) {
  const { kind, fallbackTitle, createdFallback, updatedFallback } = options;
  const parsed = parseEnvelope(markdown);
  if (parsed.attributes.schema === DOCUMENT_SCHEMA) {
    return { changed: false, content: markdown, title: yamlScalarString(parsed.attributes, 'title') || fallbackTitle };
  }

  const legacy = extractLegacyBody(parsed.body, kind);
  const title = yamlScalarString(parsed.attributes, 'title') || legacy.title || fallbackTitle;
  if (!title.trim()) throw new Error('无法确定文档标题');

  const attributes = {
    ...parsed.attributes,
    schema: DOCUMENT_SCHEMA,
    kind,
    title,
    created: yamlScalarString(parsed.attributes, 'created') || legacy.created || createdFallback,
    updated: yamlScalarString(parsed.attributes, 'updated') || legacy.updated || updatedFallback,
  };
  if (kind === 'question') {
    const existingTags = yamlStringList(parsed.attributes, 'tags');
    attributes.tags = [...new Set([...existingTags, ...legacy.tags])];
  }

  return {
    changed: true,
    content: serialize(attributes, legacy.body),
    title,
  };
}
