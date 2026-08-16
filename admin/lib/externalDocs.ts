import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';

const EXTERNAL_DOCS_PATH = path.join(PROJECT_ROOT, 'admin', 'external-docs.json');

export interface ExternalDocEntry {
  path: string;      // 规范化后的绝对路径
  addedAt: string;   // 加入索引时间 "YYYY-MM-DD HH:mm:ss"
  customTitle?: string; // 自命名标题：仅本项目的显示名映射，不改动原文件
}

export interface ExternalDocInfo {
  id: string;
  path: string;
  title: string;         // 显示名 = customTitle || 文件 H1 || 文件名
  originalTitle: string; // 文件 H1 或文件名（未被自定义标题覆盖）
  customTitle: string;   // 自命名标题（可为空）
  wordCount: number;
  mtimeMs: number | null;
  addedAt: string;
  missing: boolean;
}

function fmtTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 路径 → URL 安全的稳定 id（djb2 hash，base36） */
export function externalDocId(p: string): string {
  let h = 5381;
  for (let i = 0; i < p.length; i++) {
    h = ((h << 5) + h + p.charCodeAt(i)) | 0;
  }
  return 'ext' + (h >>> 0).toString(36);
}

export async function loadExternalDocs(): Promise<ExternalDocEntry[]> {
  try {
    const raw = await fs.readFile(EXTERNAL_DOCS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

export async function saveExternalDocs(docs: ExternalDocEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(EXTERNAL_DOCS_PATH), { recursive: true });
  await fs.writeFile(EXTERNAL_DOCS_PATH, JSON.stringify({ docs }, null, 2), 'utf-8');
}

/** 去引号、resolve 为规范化绝对路径（平台分隔符） */
export function normalizePath(p: string): string {
  let s = p.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return path.resolve(s);
}

/** 递归收集目录下所有 .md 文件（大小写不敏感） */
async function collectMdFiles(target: string): Promise<string[]> {
  const results: string[] = [];
  const isMd = (f: string) => f.toLowerCase().endsWith('.md');
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isMd(entry.name)) {
        results.push(full);
      }
    }
  }
  await walk(target);
  return results.sort();
}

/**
 * 添加外部文档路径（单个 .md 文件或目录，目录递归扫描）。
 * 按 resolve 后的路径去重，返回新增/跳过/失败明细。
 */
export async function addExternalPaths(
  inputs: string[]
): Promise<{ added: string[]; skipped: string[]; failed: { path: string; reason: string }[] }> {
  const existing = new Set((await loadExternalDocs()).map((e) => normalizePath(e.path)));
  const added: string[] = [];
  const skipped: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const input of inputs) {
    if (!input.trim()) continue;
    const target = normalizePath(input);
    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      failed.push({ path: target, reason: '路径不存在或无法访问' });
      continue;
    }

    let files: string[];
    if (stat.isDirectory()) {
      files = await collectMdFiles(target);
      if (files.length === 0) {
        failed.push({ path: target, reason: '目录下没有 .md 文件' });
        continue;
      }
    } else if (stat.isFile()) {
      if (!target.toLowerCase().endsWith('.md')) {
        failed.push({ path: target, reason: '不是 .md 文件' });
        continue;
      }
      files = [target];
    } else {
      failed.push({ path: target, reason: '不是文件或目录' });
      continue;
    }

    for (const f of files) {
      const norm = normalizePath(f);
      if (existing.has(norm)) {
        skipped.push(f);
      } else {
        existing.add(norm);
        added.push(f);
      }
    }
  }

  if (added.length > 0) {
    const docs = await loadExternalDocs();
    const now = fmtTime(new Date());
    for (const f of added) {
      docs.push({ path: f, addedAt: now });
    }
    await saveExternalDocs(docs);
  }
  return { added, skipped, failed };
}

/** 读取单文件 H1 标题，fallback 文件名 */
async function readTitle(filePath: string): Promise<string> {
  const fallback = path.basename(filePath).replace(/\.md$/i, '');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const h1 = content.match(/^#\s+(.+)/m);
    return h1 ? h1[1].trim() : fallback;
  } catch {
    return fallback;
  }
}

function countWordsExternal(md: string): number {
  const cleaned = md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^```[\s\S]*?^```\s*$/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^(#{1,6})\s+/gm, '')
    .replace(/^(\s*\|)?\s*[-:]+(\s*\|)+\s*[-:|]*\s*$/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/<[^>]+>/g, '');
  return cleaned.replace(/\s/g, '').length;
}

/**
 * 列出全部外部文档（带实时有效性检查）。
 * 排序：有效条目按文件修改时间倒序（最新在上），失效条目排最后（按加入时间倒序）。
 */
export async function listExternalDocs(): Promise<ExternalDocInfo[]> {
  const entries = await loadExternalDocs();
  const valid: ExternalDocInfo[] = [];
  const missing: ExternalDocInfo[] = [];

  for (const entry of entries) {
    const norm = normalizePath(entry.path);
    let mtimeMs: number | null = null;
    let title = path.basename(norm).replace(/\.md$/i, '');
    let wordCount = 0;
    let isMissing = false;
    try {
      const stat = await fs.stat(norm);
      mtimeMs = stat.mtimeMs;
      const content = await fs.readFile(norm, 'utf-8');
      const h1 = content.match(/^#\s+(.+)/m);
      if (h1) title = h1[1].trim();
      wordCount = countWordsExternal(content);
    } catch {
      isMissing = true;
    }
    const info: ExternalDocInfo = {
      id: externalDocId(norm),
      path: norm,
      title: entry.customTitle?.trim() || title,
      originalTitle: title,
      customTitle: entry.customTitle?.trim() || '',
      wordCount,
      mtimeMs,
      addedAt: entry.addedAt,
      missing: isMissing,
    };
    (isMissing ? missing : valid).push(info);
  }

  valid.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  missing.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return [...valid, ...missing];
}

export interface ExternalDocReadResult {
  missing: boolean;
  path: string;
  content?: string;
  mtimeMs?: number | null;
}

/** 按 id 读取索引条目对应的磁盘文件 */
export async function readExternalDocById(id: string): Promise<ExternalDocReadResult | null> {
  const entries = await loadExternalDocs();
  const entry = entries.find((e) => externalDocId(normalizePath(e.path)) === id);
  if (!entry) return null;
  const norm = normalizePath(entry.path);
  try {
    const stat = await fs.stat(norm);
    const content = await fs.readFile(norm, 'utf-8');
    return { missing: false, path: norm, content, mtimeMs: stat.mtimeMs };
  } catch {
    return { missing: true, path: norm };
  }
}

/** 按 id 写回索引条目对应的磁盘文件；文件已不存在时返回 missing + 原路径（不重建文件） */
export async function writeExternalDocById(
  id: string,
  content: string
): Promise<{ ok: boolean; missing?: boolean; path: string }> {
  const entries = await loadExternalDocs();
  const entry = entries.find((e) => externalDocId(normalizePath(e.path)) === id);
  if (!entry) return { ok: false, path: '' };
  const norm = normalizePath(entry.path);
  try {
    await fs.stat(norm);
  } catch {
    return { ok: false, missing: true, path: norm };
  }
  try {
    await fs.writeFile(norm, content, 'utf-8');
    return { ok: true, path: norm };
  } catch {
    return { ok: false, missing: true, path: norm };
  }
}

/** 从索引移除（不删除磁盘文件）。返回被移除条目的原路径。 */
export async function removeExternalDocById(id: string): Promise<string | null> {
  const entries = await loadExternalDocs();
  const idx = entries.findIndex((e) => externalDocId(normalizePath(e.path)) === id);
  if (idx < 0) return null;
  const removed = normalizePath(entries[idx].path);
  entries.splice(idx, 1);
  await saveExternalDocs(entries);
  return removed;
}

/**
 * 设置/清除自命名标题（仅改索引映射，不改动原文件）。
 * customTitle 为空字符串时清除。返回更新后的条目信息或 null（条目不存在）。
 */
export async function setExternalDocTitle(
  id: string,
  customTitle: string
): Promise<{ path: string; customTitle: string } | null> {
  const entries = await loadExternalDocs();
  const entry = entries.find((e) => externalDocId(normalizePath(e.path)) === id);
  if (!entry) return null;
  const trimmed = customTitle.trim();
  if (trimmed) {
    entry.customTitle = trimmed;
  } else {
    delete entry.customTitle;
  }
  await saveExternalDocs(entries);
  return { path: normalizePath(entry.path), customTitle: trimmed };
}
