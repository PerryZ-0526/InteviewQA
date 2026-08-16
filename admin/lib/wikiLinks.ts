import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');
const LINK_META_DIR = path.join(PROJECT_ROOT, 'admin', 'link-meta');

// ---------- 类型 ----------

export interface HeadingNode {
  level: number;          // 2/3/4
  text: string;
  children: HeadingNode[];
}

export interface DocRef {
  kind: 'category' | 'project';
  category: string;       // 分类 slug 或 project 子目录名
  filename: string;
  title: string;
}

export interface ResolvedLink {
  status: 'ok' | 'partial' | 'broken';
  resolvedPath: string[];  // 当前有效锚点路径（含回退层级）
  fallbackFrom: number;    // 从第几级开始回退（0 = 无回退）
}

interface LinkMeta {
  headings: { level: number; text: string }[];   // 扁平化 H2-H4 列表
  renames: Record<string, string>;               // 历史文本 → 当前文本
}

// ---------- 工具 ----------

export function docKeyOf(filename: string): string {
  return filename.replace(/\.md$/, '');
}

/** 解析 markdown 的 H2-H4 标题层级树 */
export function parseHeadingTree(content: string): HeadingNode[] {
  const flat: { level: number; text: string }[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^(#{2,4})\s+(.+)/);
    if (m) flat.push({ level: m[1].length, text: m[2].trim() });
  }

  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const h of flat) {
    const node: HeadingNode = { level: h.level, text: h.text, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

function flattenTree(nodes: HeadingNode[], out: { level: number; text: string }[] = []): { level: number; text: string }[] {
  for (const n of nodes) {
    out.push({ level: n.level, text: n.text });
    flattenTree(n.children, out);
  }
  return out;
}

/** 在树中按锚点路径查找，返回各层级命中的节点（支持逐级回退） */
function findAnchorPath(
  tree: HeadingNode[],
  anchorPath: string[],
  renames: Record<string, string>,
): { nodes: (HeadingNode | null)[]; fallbackFrom: number } {
  const nodes: (HeadingNode | null)[] = [];
  let levelNodes = tree;
  let fallbackFrom = 0;

  for (let i = 0; i < anchorPath.length; i++) {
    const target = anchorPath[i];
    // 先精确匹配，再用 rename 映射匹配
    let found = levelNodes.find(n => n.text === target)
      || levelNodes.find(n => renames[target] && n.text === renames[target]);
    if (found) {
      nodes.push(found);
      levelNodes = found.children;
    } else {
      // 回退：该层级及之后的锚点全部失效
      if (i === 0) {
        // 连二级标题都失效 → 文档级锚点
        return { nodes, fallbackFrom: i + 1 };
      }
      fallbackFrom = i;
      break;
    }
  }
  return { nodes, fallbackFrom };
}

/** 文档 key → 文件位置；找不到返回 null */
async function locateDoc(docKey: string): Promise<(DocRef & { filePath: string }) | null> {
  // 分类文档
  const catEntries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of catEntries) {
    if (!entry.isDirectory()) continue;
    const files = await fs.readdir(path.join(CATEGORIES_DIR, entry.name)).catch(() => []);
    for (const f of files) {
      if (docKeyOf(f) === docKey) {
        const filePath = path.join(CATEGORIES_DIR, entry.name, f);
        const content = await fs.readFile(filePath, 'utf-8');
        const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || f;
        return { kind: 'category', category: entry.name, filename: f, title, filePath };
      }
    }
  }
  // project / groups 文档
  for (const base of [PROJECT_DIR, GROUPS_DIR]) {
    const projEntries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of projEntries) {
      if (!entry.isDirectory()) continue;
      const files = await fs.readdir(path.join(base, entry.name)).catch(() => []);
      for (const f of files) {
        if (docKeyOf(f) === docKey) {
          const filePath = path.join(base, entry.name, f);
          const content = await fs.readFile(filePath, 'utf-8');
          const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || f;
          return { kind: 'project', category: entry.name, filename: f, title, filePath };
        }
      }
    }
  }
  return null;
}

// ---------- rename sidecar ----------

function metaPathOf(docRef: { kind: string; category: string; filename: string }): string {
  return path.join(LINK_META_DIR, `${docRef.kind}--${docRef.category}--${docRef.filename}.json`);
}

async function loadMeta(docRef: { kind: string; category: string; filename: string }): Promise<LinkMeta> {
  try {
    const raw = await fs.readFile(metaPathOf(docRef), 'utf-8');
    return JSON.parse(raw) as LinkMeta;
  } catch {
    return { headings: [], renames: {} };
  }
}

/** LCS 对齐新旧标题列表，检测改名并更新 rename 映射 */
function alignHeadings(oldList: { level: number; text: string }[], newList: { level: number; text: string }[]): LinkMeta {
  const n = oldList.length, m = newList.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldList[i].text === newList[j].text
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const renames: Record<string, string> = {};
  const oldAlive = new Set<string>();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldList[i].text === newList[j].text) {
      renames[oldList[i].text] = newList[j].text;
      oldAlive.add(oldList[i].text);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++; // old heading deleted
    } else {
      j++; // new heading inserted
    }
  }
  // 新增标题不是改名：不同 text 的对齐不在这里处理
  // 对 LCS 未覆盖的 old 标题，检测是否有"一对一改名"（同层级、顺序相近）
  const remainingOld = oldList.filter(h => !oldAlive.has(h.text));
  const remainingNew: { level: number; text: string }[] = [];
  const oldSet = new Set(oldList.map(h => h.text));
  for (const h of newList) if (!oldSet.has(h.text)) remainingNew.push(h);
  for (let k = 0; k < Math.min(remainingOld.length, remainingNew.length); k++) {
    if (remainingOld[k].level === remainingNew[k].level) {
      renames[remainingOld[k].text] = remainingNew[k].text;
    }
  }
  // 合并改名链：old → X → Y 折叠为 old → Y（本函数只处理单次 diff，链式合并在 save 时用旧 renames 完成）
  return { headings: newList, renames };
}

/** 保存文档时更新 sidecar（由 PUT 路由调用） */
export async function updateLinkMeta(docRef: { kind: string; category: string; filename: string }, content: string): Promise<void> {
  const tree = parseHeadingTree(content);
  const flat = flattenTree(tree);
  const prev = await loadMeta(docRef);
  const aligned = alignHeadings(prev.headings, flat);

  // 合并历史 rename 链：prev.renames[old] = X，若 X 被改名成 Y，则 prev.renames[old] = Y
  const mergedRenames: Record<string, string> = {};
  for (const [oldText, curText] of Object.entries(prev.renames)) {
    mergedRenames[oldText] = aligned.renames[curText] || curText;
  }
  for (const [oldText, curText] of Object.entries(aligned.renames)) {
    if (!mergedRenames[oldText]) mergedRenames[oldText] = curText;
  }
  // 清理指向已删除标题的映射
  const alive = new Set(flat.map(h => h.text));
  for (const key of Object.keys(mergedRenames)) {
    if (!alive.has(mergedRenames[key])) delete mergedRenames[key];
  }

  await fs.mkdir(LINK_META_DIR, { recursive: true });
  await fs.writeFile(metaPathOf(docRef), JSON.stringify({ headings: flat, renames: mergedRenames }, null, 2), 'utf-8');
}

/** 解析单个 wiki 链接（docKey + 锚点路径数组） */
export async function resolveWikiLink(docKey: string, anchorPath: string[]): Promise<{ doc: DocRef | null; resolved: ResolvedLink | null }> {
  const doc = await locateDoc(docKey);
  if (!doc) return { doc: null, resolved: null };

  if (anchorPath.length === 0) {
    return { doc, resolved: { status: 'ok', resolvedPath: [], fallbackFrom: 0 } };
  }

  const content = await fs.readFile(doc.filePath, 'utf-8');
  const tree = parseHeadingTree(content);
  const meta = await loadMeta(doc);
  const { nodes, fallbackFrom } = findAnchorPath(tree, anchorPath, meta.renames);

  if (fallbackFrom === 0 && nodes.length === anchorPath.length) {
    return { doc, resolved: { status: 'ok', resolvedPath: nodes.map(n => n!.text), fallbackFrom: 0 } };
  }
  if (nodes.length === 0) {
    // 全部失效 → 文档级
    return { doc, resolved: { status: 'broken', resolvedPath: [], fallbackFrom: 1 } };
  }
  return {
    doc,
    resolved: {
      status: nodes.length < anchorPath.length ? 'partial' : 'broken',
      resolvedPath: nodes.map(n => n!.text),
      fallbackFrom,
    },
  };
}

/** 提取文档中的 [[...]] 链接 */
export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

/** 全量搜索文档（按文件名或标题） */
export async function searchAllDocs(query: string): Promise<(DocRef & { headings: HeadingNode[] })[]> {
  const q = query.toLowerCase();
  const results: (DocRef & { headings: HeadingNode[] })[] = [];

  async function scan(dir: string, kind: 'category' | 'project') {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subPath = path.join(dir, entry.name);
      const files = await fs.readdir(subPath).catch(() => []);
      for (const f of files) {
        if (!f.match(/^\d{3}-.+\.md$/) || f === '00-index.md') continue;
        const content = await fs.readFile(path.join(subPath, f), 'utf-8').catch(() => '');
        const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || f;
        if (title.toLowerCase().includes(q) || f.toLowerCase().includes(q)) {
          results.push({
            kind, category: entry.name, filename: f, title,
            headings: parseHeadingTree(content),
          });
        }
      }
    }
  }

  await Promise.all([scan(CATEGORIES_DIR, 'category'), scan(PROJECT_DIR, 'project'), scan(GROUPS_DIR, 'project')]);
  return results.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 30);
}

/** 获取某文档的反向引用列表 */
export async function getBacklinks(kind: string, category: string, filename: string): Promise<{
  sourceKind: string; sourceCategory: string; sourceFilename: string; sourceTitle: string;
  linkText: string; resolved: ResolvedLink | null; contextAnchor: string[];
}[]> {
  const targetKey = docKeyOf(filename);
  const results: {
    sourceKind: string; sourceCategory: string; sourceFilename: string; sourceTitle: string;
    linkText: string; resolved: ResolvedLink | null; contextAnchor: string[];
  }[] = [];

  async function scan(dir: string, kind: 'category' | 'project') {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subPath = path.join(dir, entry.name);
      const files = await fs.readdir(subPath).catch(() => []);
      for (const f of files) {
        if (!f.match(/^\d{3}-.+\.md$/) || f === '00-index.md') continue;
        const content = await fs.readFile(path.join(subPath, f), 'utf-8').catch(() => '');
        const links = extractWikiLinks(content);
        for (const link of links) {
          const [docKey, ...anchors] = link.split('#').map(s => s.trim()).filter(Boolean);
          if (docKey !== targetKey) continue;
          const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || f;
          // 找到链接文本出现的位置，取最近的前置标题作为上下文锚点
          const linkIdx = content.indexOf(link);
          const before = content.slice(0, Math.max(0, linkIdx));
          const contextAnchor: string[] = [];
          for (const hLine of before.split('\n')) {
            const m = hLine.match(/^(#{2,4})\s+(.+)/);
            if (m) {
              const lv = m[1].length;
              // 维护层级路径
              while (contextAnchor.length >= lv - 1) contextAnchor.pop();
              contextAnchor.push(m[2].trim());
            }
          }
          let resolved: ResolvedLink | null = null;
          if (anchors.length > 0) {
            const r = await resolveWikiLink(docKey, anchors);
            resolved = r.resolved;
          } else {
            resolved = { status: 'ok', resolvedPath: [], fallbackFrom: 0 };
          }
          results.push({
            sourceKind: kind, sourceCategory: entry.name, sourceFilename: f, sourceTitle: title,
            linkText: link, resolved, contextAnchor,
          });
        }
      }
    }
  }

  await Promise.all([scan(CATEGORIES_DIR, 'category'), scan(PROJECT_DIR, 'project'), scan(GROUPS_DIR, 'project')]);
  return results;
}

/** 通过文件名 key 定位文档（前端跳转用） */
export async function findDoc(docKey: string): Promise<DocRef | null> {
  const doc = await locateDoc(docKey);
  return doc ? { kind: doc.kind, category: doc.category, filename: doc.filename, title: doc.title } : null;
}
