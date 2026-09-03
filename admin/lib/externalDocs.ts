import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';
import { stripMdText } from './stripText';

const EXTERNAL_DOCS_PATH = path.join(PROJECT_ROOT, 'admin', 'external-docs.json');

export interface ExternalDocEntry {
  path: string;      // 规范化后的绝对路径
  addedAt: string;   // 加入索引时间 "YYYY-MM-DD HH:mm:ss"
  customTitle?: string; // 自命名标题：仅本项目的显示名映射，不改动原文件
  group?: string;    // 所属外部文档分组名（缺省/空 = 未分组）
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
  group: string;     // 所属外部文档分组名（空字符串 = 未分组）
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

/** 读取文件中已注册的分组名列表（保持注册顺序） */
async function loadExternalGroupsRaw(): Promise<string[]> {
  try {
    const raw = await fs.readFile(EXTERNAL_DOCS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    return [];
  }
}

/**
 * 保存外部文档索引。
 * groups 未传入时沿用文件中现有的分组注册表，避免写 docs 时丢失分组。
 */
export async function saveExternalDocs(docs: ExternalDocEntry[], groups?: string[]): Promise<void> {
  const finalGroups = groups ?? (await loadExternalGroupsRaw());
  await fs.mkdir(path.dirname(EXTERNAL_DOCS_PATH), { recursive: true });
  await fs.writeFile(EXTERNAL_DOCS_PATH, JSON.stringify({ docs, groups: finalGroups }, null, 2), 'utf-8');
}

/**
 * 列出全部分组名（注册表顺序）。
 * 文档条目中引用了但未注册的分组名会自动合并进来，防止悬空引用丢失。
 */
export async function listExternalGroups(): Promise<string[]> {
  const [registered, docs] = await Promise.all([loadExternalGroupsRaw(), loadExternalDocs()]);
  const seen = new Set(registered);
  const merged = [...registered];
  for (const d of docs) {
    if (d.group && !seen.has(d.group)) {
      seen.add(d.group);
      merged.push(d.group);
    }
  }
  return merged;
}

/** 新建分组。返回更新后的分组名列表。 */
export async function createExternalGroup(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分组名不能为空');
  const groups = await listExternalGroups();
  if (groups.includes(trimmed)) throw new Error('分组已存在');
  groups.push(trimmed);
  await saveExternalDocs(await loadExternalDocs(), groups);
  return groups;
}

/** 重命名分组：同步更新注册表和所有条目的 group 字段。返回更新后的分组名列表。 */
export async function renameExternalGroup(oldName: string, newName: string): Promise<string[]> {
  const oldTrimmed = oldName.trim();
  const newTrimmed = newName.trim();
  if (!newTrimmed) throw new Error('分组名不能为空');
  const groups = await listExternalGroups();
  if (!groups.includes(oldTrimmed)) throw new Error('分组不存在');
  if (oldTrimmed === newTrimmed) return groups;
  if (groups.includes(newTrimmed)) throw new Error('目标分组名已存在');
  const docs = await loadExternalDocs();
  for (const d of docs) {
    if (d.group === oldTrimmed) d.group = newTrimmed;
  }
  const nextGroups = groups.map((g) => (g === oldTrimmed ? newTrimmed : g));
  await saveExternalDocs(docs, nextGroups);
  return nextGroups;
}

/**
 * 删除分组：条目回到未分组（不删除任何文档索引）。
 * 返回更新后的分组名列表和被移回未分组的条目数。
 */
export async function deleteExternalGroup(name: string): Promise<{ groups: string[]; movedCount: number }> {
  const trimmed = name.trim();
  const groups = await listExternalGroups();
  if (!groups.includes(trimmed)) throw new Error('分组不存在');
  const docs = await loadExternalDocs();
  let movedCount = 0;
  for (const d of docs) {
    if (d.group === trimmed) {
      delete d.group;
      movedCount++;
    }
  }
  const nextGroups = groups.filter((g) => g !== trimmed);
  await saveExternalDocs(docs, nextGroups);
  return { groups: nextGroups, movedCount };
}

/**
 * 在外部文档分组之间/内部移动条目并指定组内位置（docs 数组顺序即显示顺序）。
 * toGroup 为空字符串表示移回未分组；toIndex 为「移除被移条目后」目标分组中的
 * 0-based 插入下标（= 分组内条目数表示追加到末尾），由前端按拖拽落点计算。
 * 返回 noop 表示原位释放，未发生任何变化。
 */
export async function moveExternalDoc(
  id: string,
  toGroup: string,
  toIndex: number
): Promise<{ noop: boolean }> {
  const docs = await loadExternalDocs();
  const idx = docs.findIndex((e) => externalDocId(normalizePath(e.path)) === id);
  if (idx < 0) throw new Error('索引条目不存在');
  const target = toGroup.trim();
  const fromGroup = docs[idx].group?.trim() || '';

  // no-op 判定：同分组且落点等于原位
  const fromPositions = docs
    .map((_, i) => i)
    .filter((i) => (docs[i].group?.trim() || '') === fromGroup);
  const curPos = fromPositions.indexOf(idx);
  if (fromGroup === target && Math.round(toIndex) === curPos) return { noop: true };

  const [entry] = docs.splice(idx, 1);
  if (target) entry.group = target;
  else delete entry.group;

  // 计算插入位置：目标分组剩余条目中第 toIndex 个之前；追加则放同分组最后一条之后
  const remaining = docs
    .map((_, i) => i)
    .filter((i) => (docs[i].group?.trim() || '') === target);
  const clamped = Math.max(0, Math.min(Math.round(toIndex), remaining.length));
  const insertAt = clamped < remaining.length
    ? remaining[clamped]
    : remaining.length > 0 ? remaining[remaining.length - 1] + 1 : docs.length;
  docs.splice(insertAt, 0, entry);

  // 分组未注册时自动补注册，防止悬空引用
  const groups = await listExternalGroups();
  if (target && !groups.includes(target)) {
    await saveExternalDocs(docs, [...groups, target]);
  } else {
    await saveExternalDocs(docs);
  }
  return { noop: false };
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
 * group 非空时新增条目直接加入该分组（未注册的分组自动补注册）。
 */
export async function addExternalPaths(
  inputs: string[],
  group?: string
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
    const targetGroup = group?.trim() || '';
    for (const f of added) {
      docs.push(targetGroup ? { path: f, addedAt: now, group: targetGroup } : { path: f, addedAt: now });
    }
    // 目标分组未注册时自动补注册，防止悬空引用
    if (targetGroup) {
      const groups = await listExternalGroups();
      if (!groups.includes(targetGroup)) {
        await saveExternalDocs(docs, [...groups, targetGroup]);
        return { added, skipped, failed };
      }
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
    return h1 ? stripMdText(h1[1]) || fallback : fallback;
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
 * 排序：按索引文件中的条目顺序（docs 数组顺序即显示顺序，分组内拖拽排序的结果持久化于此）。
 */
export async function listExternalDocs(): Promise<ExternalDocInfo[]> {
  const entries = await loadExternalDocs();
  const infos: ExternalDocInfo[] = [];

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
      if (h1) title = stripMdText(h1[1]) || title;
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
      group: entry.group?.trim() || '',
    };
    infos.push(info);
  }

  return infos;
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
