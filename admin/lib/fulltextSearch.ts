import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';
import { stripMdText } from './stripText';
import { loadExternalDocs, externalDocId } from './externalDocs';

// 全文关键字检索：支持全库（分类 + project + 分组 + 外部文档）与指定目录范围两种模式

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');

export interface FullTextHit {
  kind: 'category' | 'project' | 'external';
  category: string;   // 所属分类/子目录/分组 slug；外部文档为空串
  filename?: string;  // 外部文档为空
  extId?: string;     // 仅外部文档：索引用 id
  title: string;
  count: number;      // 正文中命中次数（标题命中时可为 0）
  snippet: string;    // 首个命中位置附近的上下文片段
}

/** 统计大小写不敏感的非重叠出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
  while (idx !== -1) {
    count += 1;
    idx = haystack.toLowerCase().indexOf(needle.toLowerCase(), idx + needle.length);
  }
  return count;
}

/** 取首个命中位置附近的片段：折叠空白为单空格，前后各留约 60 字符 */
function makeSnippet(content: string, q: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  const idx = collapsed.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return collapsed.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(collapsed.length, idx + q.length + 60);
  return (start > 0 ? '…' : '') + collapsed.slice(start, end) + (end < collapsed.length ? '…' : '');
}

/** 检索单个目录（slug 目录名）下所有 md 文档，返回命中文档列表 */
async function scanDir(baseDir: string, kind: 'category' | 'project', slug: string, q: string): Promise<FullTextHit[]> {
  const dir = path.join(baseDir, slug);
  const hits: FullTextHit[] = [];
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith('.md') || f === '00-index.md') continue;
    const content = await fs.readFile(path.join(dir, f), 'utf-8').catch(() => '');
    if (!content) continue;
    const title = stripMdText(content.match(/^#\s+(.+)/m)?.[1] || '') || f;
    const count = countOccurrences(content, q);
    const titleMatch = title.toLowerCase().includes(q.toLowerCase()) || f.toLowerCase().includes(q.toLowerCase());
    // 标题或正文任一命中即收录
    if (count === 0 && !titleMatch) continue;
    hits.push({ kind, category: slug, filename: f, title, count, snippet: makeSnippet(content, q) });
  }
  return hits;
}

/** 检索外部文档索引中的所有文档（文件缺失时静默跳过） */
async function scanExternal(q: string): Promise<FullTextHit[]> {
  const hits: FullTextHit[] = [];
  const entries = await loadExternalDocs().catch(() => []);
  for (const entry of entries) {
    const content = await fs.readFile(entry.path, 'utf-8').catch(() => '');
    if (!content) continue;
    const h1 = stripMdText(content.match(/^#\s+(.+)/m)?.[1] || '');
    const title = entry.customTitle || h1 || path.basename(entry.path);
    const count = countOccurrences(content, q);
    const titleMatch = title.toLowerCase().includes(q.toLowerCase());
    if (count === 0 && !titleMatch) continue;
    hits.push({ kind: 'external', category: '', extId: externalDocId(entry.path), title, count, snippet: makeSnippet(content, q) });
  }
  return hits;
}

/**
 * 范围检索：
 * - scopeKind='category' → categories/<slug>
 * - scopeKind='project'  → project/<slug> 或 groups/<slug>（哪个存在搜哪个）
 */
export async function searchFullTextScoped(scopeKind: 'category' | 'project', slug: string, q: string): Promise<FullTextHit[]> {
  // 空关键词直接返回，避免 includes('') 恒真导致全部命中
  if (!q.trim()) return [];
  if (scopeKind === 'category') return scanDir(CATEGORIES_DIR, 'category', slug, q);
  // project 与 groups 同为「project kind」，按目录存在性定位
  const projHits = await scanDir(PROJECT_DIR, 'project', slug, q);
  if (projHits.length > 0) return projHits;
  return scanDir(GROUPS_DIR, 'project', slug, q);
}

/** 全库检索：分类 + project + 分组 + 外部文档，按命中次数降序，最多 100 条 */
export async function searchFullTextAll(q: string): Promise<FullTextHit[]> {
  // 空关键词直接返回，避免 includes('') 恒真导致全部命中
  if (!q.trim()) return [];
  const scanCategoryRoot = async () => {
    const hits: FullTextHit[] = [];
    const entries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      hits.push(...(await scanDir(CATEGORIES_DIR, 'category', e.name, q)));
    }
    return hits;
  };
  const scanProjectRoot = async (baseDir: string) => {
    const hits: FullTextHit[] = [];
    const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      hits.push(...(await scanDir(baseDir, 'project', e.name, q)));
    }
    return hits;
  };

  const [catHits, projHits, groupHits, extHits] = await Promise.all([
    scanCategoryRoot(),
    scanProjectRoot(PROJECT_DIR),
    scanProjectRoot(GROUPS_DIR),
    scanExternal(q),
  ]);

  return [...catHits, ...projHits, ...groupHits, ...extHits]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
}
