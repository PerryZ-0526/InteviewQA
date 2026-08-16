import fs from 'fs/promises';
import path from 'path';

// 项目根目录（admin/.. 即 InteviewQA/）
export const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const TAGS_DIR = path.join(PROJECT_ROOT, 'tags');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');

/** 解析 project 子目录/分组目录的真实磁盘位置（groups/ 下存在则优先） */
export async function resolveSubdirBase(subdir: string): Promise<string> {
  try {
    await fs.access(path.join(GROUPS_DIR, subdir));
    return GROUPS_DIR;
  } catch {
    return PROJECT_DIR;
  }
}

/** 统计 md 文档纯字数（去除样式符号、时间标签、空白后的字符数） */
function countWords(md: string): number {
  const cleaned = md
    .replace(/<!--[\s\S]*?-->/g, '')                    // HTML 注释（含时间标签）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')               // 图片
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                 // wiki 链接 → 文本
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')            // 普通链接 → 文本
    .replace(/`([^`]*)`/g, '$1')                        // 行内代码 → 文本
    .replace(/^```[\s\S]*?^```\s*$/gm, '')              // 代码块
    .replace(/^\s{0,3}>\s?/gm, '')                      // 引用标记
    .replace(/^\s*[-+*]\s+/gm, '')                      // 无序列表标记
    .replace(/^\s*\d+\.\s+/gm, '')                      // 有序列表标记
    .replace(/^(#{1,6})\s+/gm, '')                      // 标题标记
    .replace(/^(\s*\|)?\s*[-:]+(\s*\|)+\s*[-:|]*\s*$/gm, '') // 表格分隔行
    .replace(/[*_~>|]/g, '')                            // 强调符号与表格竖线
    .replace(/<[^>]+>/g, '');                           // 残留 HTML 标签
  return cleaned.replace(/\s/g, '').length;
}

/**
 * 获取所有分类及其题目列表
 */
export async function listCategories() {
  const entries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true });
  const categories = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const categoryPath = path.join(CATEGORIES_DIR, entry.name);
    const files = await fs.readdir(categoryPath);

    // 读取 00-index.md 获取显示名称
    const indexPath = path.join(categoryPath, '00-index.md');
    let displayName = entry.name;
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const titleMatch = indexContent.match(/^#\s+(.+?)\s*[-–—]/m);
      if (titleMatch) displayName = titleMatch[1].trim();
    } catch {}

    const questionFiles = files
      .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
      .sort();

    const questions = [];
    for (const f of questionFiles) {
      let title = f.replace(/^\d{3}-/, '').replace(/\.md$/, '');
      let wordCount = 0;
      try {
        const content = await fs.readFile(path.join(categoryPath, f), 'utf-8');
        const h1 = content.match(/^#\s+(.+)/m);
        if (h1) title = h1[1].trim();
        wordCount = countWords(content);
      } catch {}
      questions.push({ filename: f, title, wordCount });
    }

    categories.push({
      slug: entry.name,
      name: displayName,
      questionCount: questionFiles.length,
      questions,
    });
  }

  return categories.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * 读取分类下的一道题目
 */
export async function readQuestion(category: string, filename: string) {
  const filePath = path.join(CATEGORIES_DIR, category, filename);
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
}

/**
 * 直接写入题目文件（更新用）
 */
export async function writeQuestion(category: string, filename: string, content: string) {
  const filePath = path.join(CATEGORIES_DIR, category, filename);
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * 删除题目文件
 */
export async function deleteQuestion(category: string, filename: string) {
  const filePath = path.join(CATEGORIES_DIR, category, filename);
  await fs.unlink(filePath);
}

/**
 * 获取分类目录下的最大序号
 */
export async function getMaxSequence(category: string): Promise<number> {
  const categoryPath = path.join(CATEGORIES_DIR, category);
  const files = await fs.readdir(categoryPath);
  let max = 0;
  for (const f of files) {
    const match = f.match(/^(\d{3})-/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
}

/**
 * 删除文档后重新规整序号：deletedSeq 之后的所有文件序号 -1，
 * 同步更新文件名、文档内部引用、00-index.md、标签文件、wiki 链接、link-meta。
 * 返回旧文件名 → 新文件名的映射。
 */
export async function renumberCategoryAfterDelete(category: string, deletedFilename: string): Promise<Map<string, string>> {
  const renameMap = new Map<string, string>();
  const catDir = path.join(CATEGORIES_DIR, category);
  const seqMatch = deletedFilename.match(/^(\d{3})-/);
  if (!seqMatch) return renameMap;
  const deletedSeq = parseInt(seqMatch[1], 10);

  const files = (await fs.readdir(catDir))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();

  // 计算旧名 → 新名
  for (const f of files) {
    const m = f.match(/^(\d{3})-/);
    if (!m) continue;
    const seq = parseInt(m[1], 10);
    if (seq <= deletedSeq) continue;
    const newSeq = String(seq - 1).padStart(3, '0');
    renameMap.set(f, f.replace(/^\d{3}/, newSeq));
  }
  if (renameMap.size === 0) return renameMap;

  // 1. 重命名 .md 文件（序号从大到小，避免覆盖冲突）
  const sorted = [...renameMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  for (const [oldName, newName] of sorted) {
    await fs.rename(path.join(catDir, oldName), path.join(catDir, newName));
  }

  // 2. 重命名 annotations 文件
  for (const [oldName, newName] of renameMap.entries()) {
    const oldAnn = path.join(catDir, oldName.replace(/\.md$/, '-annotations.json'));
    const newAnn = path.join(catDir, newName.replace(/\.md$/, '-annotations.json'));
    try { await fs.rename(oldAnn, newAnn); } catch {}
  }

  // 3. 更新被重命名文件内部的引用（导航链接、正文交叉引用、wiki 链接）
  for (const [oldName, newName] of renameMap.entries()) {
    const filePath = path.join(catDir, newName);
    let content = await fs.readFile(filePath, 'utf-8');
    for (const [o, n] of renameMap.entries()) {
      content = content.split(o).join(n);
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }

  // 4. 重建 00-index.md
  await rebuildCategoryIndex(category);

  // 5. 更新标签文件中的引用
  await updateTagReferences(renameMap);

  // 6. 更新所有文档中的 wiki 链接引用
  await updateWikiLinkReferences(category, renameMap);

  // 7. 重命名 link-meta sidecar
  const LINK_META_DIR = path.join(PROJECT_ROOT, 'admin', 'link-meta');
  for (const [oldName, newName] of renameMap.entries()) {
    const oldMeta = path.join(LINK_META_DIR, `category--${category}--${oldName}.json`);
    const newMeta = path.join(LINK_META_DIR, `category--${category}--${newName}.json`);
    try { await fs.rename(oldMeta, newMeta); } catch {}
  }

  // 8. 重建整个分类的导航链（prev/next 双向链接）
  await fixNavigationChain(category);

  return renameMap;
}

/** 按当前磁盘文件顺序重建分类下所有文档的题目导航链接 */
export async function fixNavigationChain(category: string): Promise<void> {
  const catDir = path.join(CATEGORIES_DIR, category);
  const files = (await fs.readdir(catDir))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const filePath = path.join(catDir, f);
    let content = await fs.readFile(filePath, 'utf-8');

    const prev = i > 0 ? files[i - 1] : null;
    const next = i < files.length - 1 ? files[i + 1] : null;

    const prevPart = prev ? `← [${prev.replace(/^\d{3}-/, '').replace(/\.md$/, '')}](${prev})` : '← 无';
    const nextPart = next ? `[${next.replace(/^\d{3}-/, '').replace(/\.md$/, '')}](${next}) →` : '无 →';

    // 替换题目导航行
    const navLine = `${prevPart} | ${nextPart}`;
    if (content.includes('## 题目导航')) {
      content = content.replace(
        /## 题目导航\n\n[\s\S]*?(?=\n## |\n<!-- )/,
        `## 题目导航\n\n${navLine}\n`
      );
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

/** 从磁盘文件重建分类 00-index.md */
async function rebuildCategoryIndex(category: string): Promise<void> {
  const catDir = path.join(CATEGORIES_DIR, category);
  const indexPath = path.join(catDir, '00-index.md');

  // 解析旧索引：保留显示名和 brief
  let displayName = category;
  const oldBriefs = new Map<string, string>();
  try {
    const old = await fs.readFile(indexPath, 'utf-8');
    const titleMatch = old.match(/^#\s+(.+?)\s*[-–—]/m);
    if (titleMatch) displayName = titleMatch[1].trim();
    for (const line of old.split('\n')) {
      const m = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
      if (m) oldBriefs.set(m[2], m[3]);
    }
  } catch {}

  const files = (await fs.readdir(catDir))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();

  const lines: string[] = [];
  for (const f of files) {
    let title = f.replace(/^\d{3}-/, '').replace(/\.md$/, '');
    try {
      const content = await fs.readFile(path.join(catDir, f), 'utf-8');
      const h1 = content.match(/^#\s+(.+)/m);
      if (h1) title = h1[1].trim();
    } catch {}
    const brief = oldBriefs.get(f) || title.slice(0, 30);
    lines.push(`- [${title}](${f}) - ${brief}`);
  }

  const indexContent = `# ${displayName} - 题目索引\n\n## 题目列表\n\n${lines.join('\n')}\n`;
  await fs.writeFile(indexPath, indexContent, 'utf-8');
}

/** 更新标签文件中的文件名引用 */
async function updateTagReferences(renameMap: Map<string, string>): Promise<void> {
  const entries = await fs.readdir(TAGS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const tagPath = path.join(TAGS_DIR, entry.name);
    let content = await fs.readFile(tagPath, 'utf-8');
    let changed = false;
    for (const [oldName, newName] of renameMap.entries()) {
      if (content.includes(oldName)) {
        content = content.split(oldName).join(newName);
        changed = true;
      }
    }
    if (changed) await fs.writeFile(tagPath, content, 'utf-8');
  }
}

/** 更新分类文档和 project 文档中的 wiki 链接引用 */
async function updateWikiLinkReferences(category: string, renameMap: Map<string, string>): Promise<void> {
  // 只更新本分类内的文档 + 全库扫描 wiki 链接
  async function scanDir(dir: string, base: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subPath = path.join(dir, entry.name);
      const files = await fs.readdir(subPath).catch(() => []);
      for (const f of files) {
        if (!f.match(/^\d{3}-.+\.md$/) || f === '00-index.md') continue;
        const filePath = path.join(subPath, f);
        let content = await fs.readFile(filePath, 'utf-8');
        let changed = false;
        for (const [oldName, newName] of renameMap.entries()) {
          const oldBare = oldName.replace(/\.md$/, '');
          const newBare = newName.replace(/\.md$/, '');
          // wiki 链接形式 [[oldBare#...]]
          const wikiRegex = new RegExp(`\\[\\[${oldBare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(#[^\\]]*)?\\]\\]`, 'g');
          if (wikiRegex.test(content)) {
            content = content.replace(wikiRegex, (_m, anchor) => `[[${newBare}${anchor || ''}]]`);
            changed = true;
          }
        }
        if (changed) await fs.writeFile(filePath, content, 'utf-8');
      }
    }
  }
  await Promise.all([
    scanDir(CATEGORIES_DIR, category),
    scanDir(path.join(PROJECT_ROOT, 'project'), 'project'),
    scanDir(path.join(PROJECT_ROOT, 'groups'), 'groups'),
  ]);
}

/**
 * 获取所有标签列表
 */
export async function listTags() {
  const entries = await fs.readdir(TAGS_DIR, { withFileTypes: true });
  const tags = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(TAGS_DIR, entry.name);
    const content = await fs.readFile(filePath, 'utf-8');
    const tagName = entry.name.replace(/\.md$/, '');

    // 解析标签文件中的题目链接
    const questionLinks: { category: string; filename: string; title: string }[] = [];
    const linkRegex = /\[([^\]]+)\]\(\.\.\/categories\/([^/]+)\/([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      questionLinks.push({
        title: match[1],
        category: match[2],
        filename: match[3],
      });
    }

    tags.push({ name: tagName, questions: questionLinks });
  }

  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 检查分类目录是否存在
 */
export async function categoryExists(slug: string): Promise<boolean> {
  try {
    await fs.access(path.join(CATEGORIES_DIR, slug));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取 README.md
 */
export async function readReadme(): Promise<string> {
  const filePath = path.join(PROJECT_ROOT, 'README.md');
  return fs.readFile(filePath, 'utf-8');
}

/** 分组注册表：记录「新建分组」创建的 project 子目录（在侧边栏展示为独立区块） */
const GROUP_REGISTRY_PATH = path.join(PROJECT_ROOT, 'admin', 'group-registry.json');

async function loadGroupRegistry(): Promise<string[]> {
  try {
    const raw = await fs.readFile(GROUP_REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    return [];
  }
}

async function saveGroupRegistry(groups: string[]): Promise<void> {
  await fs.mkdir(path.dirname(GROUP_REGISTRY_PATH), { recursive: true });
  await fs.writeFile(GROUP_REGISTRY_PATH, JSON.stringify({ groups }, null, 2), 'utf-8');
}

/**
 * 获取 project/ 与 groups/ 下的所有子目录及其文档列表（结构等同于 categories）
 * isGroup = groups/ 下的目录或注册表中的历史分组（侧边栏独立区块展示）
 */
export async function listProjectDocs() {
  const groupSet = new Set(await loadGroupRegistry());
  const subdirs: { slug: string; name: string; isGroup: boolean; docs: { filename: string; title: string; brief: string; wordCount: number }[] }[] = [];

  for (const base of [PROJECT_DIR, GROUPS_DIR]) {
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subdirPath = path.join(base, entry.name);
      const indexPath = path.join(subdirPath, '00-index.md');
      const docs: { filename: string; title: string; brief: string; wordCount: number }[] = [];

      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const displayName = entry.name;
        const lines = content.split('\n');
        for (const line of lines) {
          const match = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
          if (match) {
            // 从实际文件 H1 读取标题（与 categories 一致），index 条目文本仅作 fallback
            let title = match[1];
            let wordCount = 0;
            try {
              const docContent = await fs.readFile(path.join(subdirPath, match[2]), 'utf-8');
              const h1 = docContent.match(/^#\s+(.+)/m);
              if (h1) title = h1[1].trim();
              wordCount = countWords(docContent);
            } catch {}
            docs.push({ title, filename: match[2], brief: match[3], wordCount });
          }
        }
        subdirs.push({ slug: entry.name, name: displayName, isGroup: base === GROUPS_DIR || groupSet.has(entry.name), docs });
      } catch {}
    }
  }

  return subdirs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** 在 groups/ 目录下创建分组（侧边栏独立区块） */
export async function createGroupSubdir(slug: string, displayName: string): Promise<void> {
  const dirPath = path.join(GROUPS_DIR, slug);
  await fs.mkdir(dirPath, { recursive: true });
  const indexContent = `# ${displayName} - 分组文档索引\n\n## 文档列表\n\n`;
  await fs.writeFile(path.join(dirPath, '00-index.md'), indexContent, 'utf-8');
  const groups = await loadGroupRegistry();
  if (!groups.includes(slug)) {
    groups.push(slug);
    await saveGroupRegistry(groups);
  }
}

/**
 * 读取 project/<subdir>/ 或 groups/<subdir>/ 下的一篇文档
 */
export async function readProjectDoc(subdir: string, filename: string): Promise<string | null> {
  try {
    const base = await resolveSubdirBase(subdir);
    const filePath = path.join(base, subdir, filename);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeProjectDoc(subdir: string, filename: string, content: string): Promise<void> {
  const base = await resolveSubdirBase(subdir);
  const filePath = path.join(base, subdir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
}

/** 创建新分类目录 + 00-index.md */
export async function createCategory(slug: string, displayName: string): Promise<void> {
  const dirPath = path.join(CATEGORIES_DIR, slug);
  await fs.mkdir(dirPath, { recursive: true });
  const indexContent = `# ${displayName} - 题目索引\n\n## 题目列表\n\n`;
  await fs.writeFile(path.join(dirPath, '00-index.md'), indexContent, 'utf-8');
}

/** 获取 project/groups 子目录下的最大序号 */
export async function getProjectMaxSequence(subdir: string): Promise<number> {
  const base = await resolveSubdirBase(subdir);
  const dirPath = path.join(base, subdir);
  const files = await fs.readdir(dirPath);
  let max = 0;
  for (const f of files) {
    const match = f.match(/^(\d{3})-/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
}

/** 创建 project 子目录 + 00-index.md */
export async function createProjectSubdir(slug: string, displayName: string): Promise<void> {
  const dirPath = path.join(PROJECT_DIR, slug);
  await fs.mkdir(dirPath, { recursive: true });
  const indexContent = `# ${displayName} - 项目文档索引\n\n## 文档列表\n\n`;
  await fs.writeFile(path.join(dirPath, '00-index.md'), indexContent, 'utf-8');
}

/** 在 project/groups 子目录下创建文档 */
export async function createProjectDocFile(subdir: string, filename: string, title: string): Promise<void> {
  const base = await resolveSubdirBase(subdir);
  const filePath = path.join(base, subdir, filename);
  const content = `# ${title}\n\n`;
  await fs.writeFile(filePath, content, 'utf-8');

  // 更新 00-index.md
  const indexPath = path.join(base, subdir, '00-index.md');
  let idx = await fs.readFile(indexPath, 'utf-8');
  idx = idx.trimEnd() + `\n- [${title}](${filename}) - 待补充\n`;
  await fs.writeFile(indexPath, idx, 'utf-8');
}




