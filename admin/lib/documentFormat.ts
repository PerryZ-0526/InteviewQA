import { parseDocument, stringify } from 'yaml';
import {
  parseSectionedBody,
  QUESTION_BODY_SCHEMA,
  sectionLabel,
  serializeQuestionBody,
} from './sectionMarkers';

export const DOCUMENT_SCHEMA = 'interviewqa/v2';
export const FREEFORM_BODY_SCHEMA = 'interviewqa/freeform-v1';

export type DocumentKind = 'question' | 'document';
export type DocumentSourceFormat = 'legacy' | 'frontmatter-v2';
export type FrontmatterData = Record<string, unknown>;

export interface ParsedMarkdownDocument {
  attributes: FrontmatterData;
  body: string;
  hasFrontmatter: boolean;
  sourceFormat: DocumentSourceFormat;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const PRIORITY_KEYS = ['schema', 'kind', 'body_schema', 'title', 'tags', 'created', 'updated'];

function asRecord(value: unknown): FrontmatterData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as FrontmatterData;
}

export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return {
      attributes: {},
      body: normalized,
      hasFrontmatter: false,
      sourceFormat: 'legacy',
    };
  }

  const document = parseDocument(match[1], {
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`YAML frontmatter 解析失败: ${document.errors[0].message}`);
  }

  const attributes = asRecord(document.toJS());
  let body = normalized.slice(match[0].length);
  // 序列化器固定在 frontmatter 后留一个空行；解析时仅移除这一个结构性空行。
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);

  return {
    attributes,
    body,
    hasFrontmatter: true,
    sourceFormat: attributes.schema === DOCUMENT_SCHEMA ? 'frontmatter-v2' : 'legacy',
  };
}

function orderedAttributes(attributes: FrontmatterData): FrontmatterData {
  const ordered: FrontmatterData = {};
  for (const key of PRIORITY_KEYS) {
    if (attributes[key] !== undefined) ordered[key] = attributes[key];
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!PRIORITY_KEYS.includes(key) && value !== undefined) ordered[key] = value;
  }
  return ordered;
}

export function serializeMarkdownDocument(attributes: FrontmatterData, body: string): string {
  const yaml = stringify(orderedAttributes(attributes), {
    lineWidth: 0,
    minContentWidth: 0,
  }).trimEnd();
  const envelope = `---\n${yaml}\n---\n`;
  return body ? `${envelope}\n${body}` : envelope;
}

export function serializeV2Document(
  attributes: FrontmatterData,
  body: string,
  kind: DocumentKind,
): string {
  return serializeMarkdownDocument(
    {
      ...attributes,
      schema: DOCUMENT_SCHEMA,
      kind,
    },
    body,
  );
}

export function metadataString(attributes: FrontmatterData, key: string): string {
  const value = attributes[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function metadataStringList(attributes: FrontmatterData, key: string): string[] {
  const value = attributes[key];
  if (Array.isArray(value)) {
    return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }
  return [];
}

export function isV2Markdown(markdown: string): boolean {
  return parseMarkdownDocument(markdown).sourceFormat === 'frontmatter-v2';
}

export function isSectionMarkerQuestion(markdown: string): boolean {
  const document = parseMarkdownDocument(markdown);
  return document.sourceFormat === 'frontmatter-v2'
    && document.attributes.kind === 'question'
    && document.attributes.body_schema === QUESTION_BODY_SCHEMA;
}

function hasActiveSectionMarkers(body: string): boolean {
  let inCodeBlock = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (
      !inCodeBlock
      && (
        line.trim().startsWith('<!-- interviewqa:section ')
        || line.trim() === '<!-- interviewqa:end -->'
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isFreeformCategoryDocument(markdown: string): boolean {
  const document = parseMarkdownDocument(markdown);
  return document.sourceFormat === 'frontmatter-v2'
    && document.attributes.kind === 'document'
    && document.attributes.body_schema === FREEFORM_BODY_SCHEMA
    && !hasActiveSectionMarkers(document.body);
}

export function categoryDocumentKind(markdown: string): DocumentKind {
  return isFreeformCategoryDocument(markdown) ? 'document' : 'question';
}

export function strictCategoryDocumentKind(markdown: string): DocumentKind | null {
  if (isSectionMarkerQuestion(markdown)) {
    try {
      const document = parseMarkdownDocument(markdown);
      const parsedBody = parseSectionedBody(document.body);
      const standardTypes = new Set(
        parsedBody.sections
          .filter((section) => section.descriptor.type !== 'custom')
          .map((section) => section.descriptor.type),
      );
      if (['question', 'answer', 'analysis'].every((type) => standardTypes.has(type as 'question' | 'answer' | 'analysis'))) {
        return 'question';
      }
    } catch {}
  }
  if (isFreeformCategoryDocument(markdown)) return 'document';
  return null;
}

export function convertCategoryDocument(
  markdown: string,
  targetKind: DocumentKind,
  updatedAt: string,
): string {
  const document = parseMarkdownDocument(markdown);
  const sourceKind = strictCategoryDocumentKind(markdown);
  if (!sourceKind) throw new Error('只支持转换合法的 v2 分类文档');
  if (sourceKind === targetKind) return markdown;

  const attributes = {
    ...document.attributes,
    updated: updatedAt,
  };
  if (targetKind === 'document') {
    const parsedBody = parseSectionedBody(document.body);
    const parts = [
      parsedBody.preamble,
      ...parsedBody.sections.map((section) => {
        if (!section.content.trim()) return '';
        return section.descriptor.type === 'custom'
          ? `## ${sectionLabel(section.descriptor)}\n\n${section.content}`
          : section.content;
      }),
    ].filter((part) => part.trim());
    return serializeV2Document(
      {
        ...attributes,
        body_schema: FREEFORM_BODY_SCHEMA,
      },
      parts.join('\n\n'),
      'document',
    );
  }

  return serializeV2Document(
    {
      ...attributes,
      body_schema: QUESTION_BODY_SCHEMA,
    },
    serializeQuestionBody({
      question: '',
      answer: '',
      analysis: document.body,
    }),
    'question',
  );
}

/** v2 优先读 frontmatter.title；旧文档只认正文开头的第一个 H1，绝不吞正文中间的 H1。 */
export function documentTitle(markdown: string, fallback = ''): string {
  const parsed = parseMarkdownDocument(markdown);
  const metadataTitle = metadataString(parsed.attributes, 'title');
  if (parsed.sourceFormat === 'frontmatter-v2' && metadataTitle) return metadataTitle;

  const lines = parsed.body.split(/\r?\n/);
  const firstContent = lines.find((line) => line.trim().length > 0);
  const heading = firstContent?.match(/^#\s+(.+)/);
  return heading?.[1]?.trim() || metadataTitle || fallback;
}
