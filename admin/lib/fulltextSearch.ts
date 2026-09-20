import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';
import { stripMdText } from './stripText';
import { loadExternalDocs, externalDocId } from './externalDocs';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');

export interface FullTextHit {
  kind: 'category' | 'project' | 'external';
  category: string;
  filename?: string;
  extId?: string;
  title: string;
  count: number;
  snippet: string;
}

interface IndexedDocument {
  mtimeMs: number;
  size: number;
  contentLower: string;
  collapsed: string;
  collapsedLower: string;
  h1: string;
}

const documentIndex = new Map<string, IndexedDocument>();
const pendingReads = new Map<string, Promise<IndexedDocument | null>>();
let indexedReads = 0;
let cacheHits = 0;

async function indexDocument(filePath: string): Promise<IndexedDocument | null> {
  const existingRead = pendingReads.get(filePath);
  if (existingRead) return existingRead;

  const task = (async () => {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      documentIndex.delete(filePath);
      return null;
    }

    const cached = documentIndex.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cacheHits += 1;
      return cached;
    }

    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (!content) {
      documentIndex.delete(filePath);
      return null;
    }
    indexedReads += 1;
    const collapsed = content.replace(/\s+/g, ' ').trim();
    const indexed: IndexedDocument = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentLower: content.toLowerCase(),
      collapsed,
      collapsedLower: collapsed.toLowerCase(),
      h1: stripMdText(content.match(/^#\s+(.+)/m)?.[1] || ''),
    };
    documentIndex.set(filePath, indexed);
    return indexed;
  })().finally(() => pendingReads.delete(filePath));

  pendingReads.set(filePath, task);
  return task;
}

function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower) return 0;
  let count = 0;
  let index = haystackLower.indexOf(needleLower);
  while (index !== -1) {
    count += 1;
    index = haystackLower.indexOf(needleLower, index + needleLower.length);
  }
  return count;
}

function makeSnippet(indexed: IndexedDocument, query: string, queryLower: string): string {
  const index = indexed.collapsedLower.indexOf(queryLower);
  if (index === -1) return indexed.collapsed.slice(0, 120);
  const start = Math.max(0, index - 60);
  const end = Math.min(indexed.collapsed.length, index + query.length + 60);
  return `${start > 0 ? '…' : ''}${indexed.collapsed.slice(start, end)}${end < indexed.collapsed.length ? '…' : ''}`;
}

function matchIndexedDocument(
  indexed: IndexedDocument,
  query: string,
  queryLower: string,
  title: string,
  filename?: string,
): Pick<FullTextHit, 'count' | 'snippet'> | null {
  const count = countOccurrences(indexed.contentLower, queryLower);
  const titleMatch = title.toLowerCase().includes(queryLower) || filename?.toLowerCase().includes(queryLower);
  if (count === 0 && !titleMatch) return null;
  return { count, snippet: makeSnippet(indexed, query, queryLower) };
}

async function scanDir(
  baseDir: string,
  kind: 'category' | 'project',
  slug: string,
  query: string,
  queryLower: string,
): Promise<FullTextHit[]> {
  const dir = path.join(baseDir, slug);
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const hits = await Promise.all(files.map(async (filename): Promise<FullTextHit | null> => {
    if (!filename.endsWith('.md') || filename === '00-index.md') return null;
    const indexed = await indexDocument(path.join(dir, filename));
    if (!indexed) return null;
    const title = indexed.h1 || filename;
    const match = matchIndexedDocument(indexed, query, queryLower, title, filename);
    return match ? { kind, category: slug, filename, title, ...match } : null;
  }));
  return hits.filter((hit): hit is FullTextHit => hit !== null);
}

async function scanExternal(query: string, queryLower: string, group?: string): Promise<FullTextHit[]> {
  const entries = await loadExternalDocs().catch(() => []);
  const hits = await Promise.all(entries.map(async (entry): Promise<FullTextHit | null> => {
    if (group !== undefined && (entry.group?.trim() || '') !== group) return null;
    const indexed = await indexDocument(entry.path);
    if (!indexed) return null;
    const title = entry.customTitle || indexed.h1 || path.basename(entry.path);
    const match = matchIndexedDocument(indexed, query, queryLower, title);
    return match
      ? { kind: 'external', category: group ?? '', extId: externalDocId(entry.path), title, ...match }
      : null;
  }));
  return hits.filter((hit): hit is FullTextHit => hit !== null);
}

export async function searchFullTextExternalGroup(group: string, query: string): Promise<FullTextHit[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  return scanExternal(normalized, normalized.toLowerCase(), group);
}

export async function searchFullTextScoped(
  scopeKind: 'category' | 'project',
  slug: string,
  query: string,
): Promise<FullTextHit[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const queryLower = normalized.toLowerCase();
  if (scopeKind === 'category') return scanDir(CATEGORIES_DIR, 'category', slug, normalized, queryLower);
  try {
    const stat = await fs.stat(path.join(PROJECT_DIR, slug));
    if (stat.isDirectory()) return scanDir(PROJECT_DIR, 'project', slug, normalized, queryLower);
  } catch {}
  return scanDir(GROUPS_DIR, 'project', slug, normalized, queryLower);
}

export async function searchFullTextAll(query: string): Promise<FullTextHit[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const queryLower = normalized.toLowerCase();

  const scanRoot = async (baseDir: string, kind: 'category' | 'project') => {
    const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    const batches = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => scanDir(baseDir, kind, entry.name, normalized, queryLower)),
    );
    return batches.flat();
  };

  const [categoryHits, projectHits, groupHits, externalHits] = await Promise.all([
    scanRoot(CATEGORIES_DIR, 'category'),
    scanRoot(PROJECT_DIR, 'project'),
    scanRoot(GROUPS_DIR, 'project'),
    scanExternal(normalized, queryLower),
  ]);

  return [...categoryHits, ...projectHits, ...groupHits, ...externalHits]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
}

export function getFulltextIndexStats() {
  return { entries: documentIndex.size, indexedReads, cacheHits };
}

export function clearFulltextIndex() {
  documentIndex.clear();
  pendingReads.clear();
  indexedReads = 0;
  cacheHits = 0;
}
