import fs from 'fs/promises';
import path from 'path';
import { backupBeforeWrite } from './backup';
import { PROJECT_ROOT } from './paths';
import { stripMdText } from './stripText';

export { PROJECT_ROOT };

// 项目根目录（admin/.. 即 InteviewQA/）
const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const TAGS_DIR = path.join(PROJECT_ROOT, 'tags');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');
const GROUPS_DIR = path.join(PROJECT_ROOT, 'groups');
const LINK_META_DIR = path.join(PROJECT_ROOT, 'admin', 'link-meta');

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
      if (titleMatch) displayName = stripMdText(titleMatch[1]);
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
        if (h1) title = stripMdText(h1[1]);
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
 * 写文件前先备份旧内容（重排/移动等批量改写场景的统一入口）。
 * backupBeforeWrite 内部带 5 分钟节流与版本上限，失败静默。
 */
async function writeFileWithBackup(relDir: string, filename: string, content: string): Promise<void> {
  await backupBeforeWrite(relDir, filename, content);
  await fs.writeFile(path.join(PROJECT_ROOT, relDir, filename), content, 'utf-8');
}

/** 对内容应用一组文件名重命名（含 %20 编码形式与 [[...]]/转义 wiki 引用），返回新内容 */
function applyRenameMapsToContent(content: string, renameMap: Map<string, string>): string {
  let next = content;
  for (const [oldName, newName] of renameMap.entries()) {
    for (const [o, n] of [[oldName, newName], [encodeURI(oldName), encodeURI(newName)]]) {
      if (o !== n && next.includes(o)) next = next.split(o).join(n);
    }
    const oldBare = oldName.replace(/\.md$/, '');
    const newBare = newName.replace(/\.md$/, '');
    // wiki 链接形式 [[oldBare#...]]，兼容正文中被转义的 \[\[oldBare#...\]\]（反斜杠保留）
    const wikiRegex = new RegExp(`(\\\\?)\\[\\[${oldBare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(#[^\\]]*)?\\]\\]`, 'g');
    next = next.replace(wikiRegex, (_m, esc, anchor) => `${esc}[[${newBare}${anchor || ''}]]`);
  }
  return next;
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
  return renumberDirAfterDelete(
    path.join(CATEGORIES_DIR, category),
    path.join('categories', category),
    'category',
    category,
    deletedFilename,
    () => rebuildCategoryIndex(category),
  );
}

/**
 * 删除 project/groups 子目录文档后重新规整序号（联动逻辑与分类一致）：
 * 后续文件序号 -1，同步更新文件名、文档内部引用、00-index.md、wiki 链接、link-meta、导航链。
 * 返回旧文件名 -> 新文件名的映射。
 */
export async function renumberProjectSubdirAfterDelete(subdir: string, deletedFilename: string): Promise<Map<string, string>> {
  const base = await resolveSubdirBase(subdir);
  const relBase = path.relative(PROJECT_ROOT, base); // 'project' 或 'groups'
  return renumberDirAfterDelete(
    path.join(base, subdir),
    path.join(relBase, subdir),
    'project',
    subdir,
    deletedFilename,
    () => rebuildSubdirIndex(base, subdir),
  );
}

/**
 * 目录级序号重排核心（categories / project / groups 共用）：
 * 重命名 .md 与 annotations 侧车 -> 改写被重命名文件内部引用 -> 重建 00-index.md ->
 * 分类场景更新标签引用 -> 全库 wiki 链接改写 -> link-meta 侧车改名 -> 重建导航链。
 */
async function renumberDirAfterDelete(
  dirPath: string,
  relDir: string,
  metaKind: 'category' | 'project',
  metaCategory: string,
  deletedFilename: string,
  rebuildIndex: () => Promise<void>,
): Promise<Map<string, string>> {
  const renameMap = new Map<string, string>();
  const seqMatch = deletedFilename.match(/^(\d{3})-/);
  if (!seqMatch) return renameMap;
  const deletedSeq = parseInt(seqMatch[1], 10);

  const files = (await fs.readdir(dirPath))
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

  // 1. 重命名 .md 文件（序号从大到小，避免覆盖冲突）
  const sorted = [...renameMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  for (const [oldName, newName] of sorted) {
    await fs.rename(path.join(dirPath, oldName), path.join(dirPath, newName));
  }

  // 2. 重命名 annotations 文件。实际命名为 <seq>-annotations.json（如 004-annotations.json），
  //    旧 <stem>-annotations.json 命名作 fallback 兼容。
  for (const [oldName, newName] of renameMap.entries()) {
    const oldSeq = oldName.slice(0, 3);
    const newSeq = newName.slice(0, 3);
    for (const [o, n] of [
      [`${oldSeq}-annotations.json`, `${newSeq}-annotations.json`],
      [oldName.replace(/\.md$/, '-annotations.json'), newName.replace(/\.md$/, '-annotations.json')],
    ]) {
      if (o === n) continue;
      try { await fs.rename(path.join(dirPath, o), path.join(dirPath, n)); } catch {}
    }
  }

  // 3. 更新被重命名文件内部的引用（导航链接、正文交叉引用、wiki 链接）
  for (const [oldName, newName] of renameMap.entries()) {
    const filePath = path.join(dirPath, newName);
    const content = await fs.readFile(filePath, 'utf-8');
    const next = applyRenameMapsToContent(content, renameMap);
    if (next !== content) await writeFileWithBackup(relDir, newName, next);
  }

  // 4. 重建 00-index.md（无论是否有重命名都执行：删除末位文档时无重排，但仍需移除索引条目）
  await rebuildIndex();

  // 5. 更新标签文件中的引用（project/groups 文档不出现在 tags/*.md 中，仅分类需要）
  if (metaKind === 'category') await updateTagReferences(renameMap);

  // 6. 更新所有文档中的 wiki 链接引用
  await updateWikiLinkReferences(metaCategory, renameMap);

  // 7. 重命名 link-meta sidecar
  for (const [oldName, newName] of renameMap.entries()) {
    const oldMeta = path.join(LINK_META_DIR, `${metaKind}--${metaCategory}--${oldName}.json`);
    const newMeta = path.join(LINK_META_DIR, `${metaKind}--${metaCategory}--${newName}.json`);
    try { await fs.rename(oldMeta, newMeta); } catch {}
  }

  // 8. 重建整个目录的导航链（prev/next 双向链接）
  await fixNavigationChainInDir(dirPath, relDir);

  return renameMap;
}

/** 按当前磁盘文件顺序重建分类下所有文档的题目导航链接 */
export async function fixNavigationChain(category: string): Promise<void> {
  await fixNavigationChainInDir(path.join(CATEGORIES_DIR, category), path.join('categories', category));
}

/** 按当前磁盘文件顺序重建指定目录（categories/project/groups）下所有文档的题目导航链接 */
async function fixNavigationChainInDir(dirPath: string, relDir: string): Promise<void> {
  const files = (await fs.readdir(dirPath))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const filePath = path.join(dirPath, f);
    let content = await fs.readFile(filePath, 'utf-8');

    const prev = i > 0 ? files[i - 1] : null;
    const next = i < files.length - 1 ? files[i + 1] : null;

    const prevPart = prev ? `← [${prev.replace(/^\d{3}-/, '').replace(/\.md$/, '')}](${prev})` : '← 无';
    const nextPart = next ? `[${next.replace(/^\d{3}-/, '').replace(/\.md$/, '')}](${next}) →` : '无 →';

    // 替换题目导航行
    const navLine = `${prevPart} | ${nextPart}`;
    if (content.includes('## 题目导航')) {
      const updated = content.replace(
        /## 题目导航\n\n[\s\S]*?(?=\n## |\n<!-- )/,
        `## 题目导航\n\n${navLine}\n`
      );
      if (updated !== content) await writeFileWithBackup(relDir, f, updated);
    }
  }
}

/** 从磁盘文件重建分类 00-index.md */
export async function rebuildCategoryIndex(category: string): Promise<void> {
  const catDir = path.join(CATEGORIES_DIR, category);
  const indexPath = path.join(catDir, '00-index.md');

  // 解析旧索引：保留显示名和 brief
  let displayName = category;
  const oldBriefs = new Map<string, string>();
  try {
    const old = await fs.readFile(indexPath, 'utf-8');
    const titleMatch = old.match(/^#\s+(.+?)\s*[-–—]/m);
    if (titleMatch) displayName = stripMdText(titleMatch[1]);
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
      if (h1) title = stripMdText(h1[1]);
    } catch {}
    const brief = oldBriefs.get(f) || title.slice(0, 30);
    lines.push(`- [${title}](${f}) - ${brief}`);
  }

  const indexContent = `# ${displayName} - 题目索引\n\n## 题目列表\n\n${lines.join('\n')}\n`;
  await writeFileWithBackup(path.join('categories', category), '00-index.md', indexContent);
}

/**
 * 从磁盘文件重建 project/groups 子目录 00-index.md（删除文档后移除条目用）。
 * 保留原索引头部第一行与各条目说明（brief），条目按磁盘文件顺序重建。
 */
async function rebuildSubdirIndex(base: string, subdir: string): Promise<void> {
  const dirPath = path.join(base, subdir);
  const indexPath = path.join(dirPath, '00-index.md');
  const relDir = path.join(path.relative(PROJECT_ROOT, base), subdir);

  // 解析旧索引：保留头部第一行和 brief
  let header = projectIndexHeader(base, subdir);
  const oldBriefs = new Map<string, string>();
  try {
    const old = await fs.readFile(indexPath, 'utf-8');
    const firstLine = old.split('\n').find((l) => l.trim().length > 0);
    if (firstLine?.startsWith('#')) header = firstLine.trim();
    for (const line of old.split('\n')) {
      const m = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
      if (m) oldBriefs.set(m[2], m[3]);
    }
  } catch {}

  const files = (await fs.readdir(dirPath))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();

  const lines: string[] = [];
  for (const f of files) {
    let title = f.replace(/^\d{3}-/, '').replace(/\.md$/, '');
    try {
      const content = await fs.readFile(path.join(dirPath, f), 'utf-8');
      const h1 = content.match(/^#\s+(.+)/m);
      if (h1) title = stripMdText(h1[1]);
    } catch {}
    const brief = oldBriefs.get(f) || title.slice(0, 30);
    lines.push(`- [${title}](${f}) - ${brief}`);
  }

  const indexContent = `${header}\n\n## 文档列表\n\n${lines.join('\n')}\n`;
  await writeFileWithBackup(relDir, '00-index.md', indexContent);
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
      // 兼容 %20 编码的文件名（部分标签条目以 encodeURI 形式书写）
      for (const [o, n] of [[oldName, newName], [encodeURI(oldName), encodeURI(newName)]]) {
        if (o !== n && content.includes(o)) {
          content = content.split(o).join(n);
          changed = true;
        }
      }
    }
    if (changed) await fs.writeFile(tagPath, content, 'utf-8');
  }
}

/** 更新分类文档和 project 文档中的 wiki 链接引用 */
async function updateWikiLinkReferences(category: string, renameMap: Map<string, string>): Promise<void> {
  // 只更新本分类内的文档 + 全库扫描 wiki 链接
  async function scanDir(dir: string, relBase: string) {
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
          // wiki 链接形式 [[oldBare#...]]，兼容正文中被转义的 \[\[oldBare#...\]\]（反斜杠保留）
          const wikiRegex = new RegExp(`(\\\\?)\\[\\[${oldBare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(#[^\\]]*)?\\]\\]`, 'g');
          if (wikiRegex.test(content)) {
            content = content.replace(wikiRegex, (_m, esc, anchor) => `${esc}[[${newBare}${anchor || ''}]]`);
            changed = true;
          }
        }
        if (changed) await writeFileWithBackup(path.join(relBase, entry.name), f, content);
      }
    }
  }
  await Promise.all([
    scanDir(CATEGORIES_DIR, 'categories'),
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

      // 优先从 00-index.md 解析条目
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
          if (match) {
            // 从实际文件 H1 读取标题（与 categories 一致），index 条目文本仅作 fallback
            let title = match[1];
            let wordCount = 0;
            try {
              const docContent = await fs.readFile(path.join(subdirPath, match[2]), 'utf-8');
              const h1 = docContent.match(/^#\s+(.+)/m);
              if (h1) title = stripMdText(h1[1]);
              wordCount = countWords(docContent);
            } catch {}
            docs.push({ title, filename: match[2], brief: match[3], wordCount });
          }
        }
      } catch {}

      // 兜底：目录中未被 index 登记的文档直接补入（index 缺失/为空/过期时前端仍能展示）
      const listed = new Set(docs.map((d) => d.filename));
      try {
        const files = (await fs.readdir(subdirPath))
          .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
          .sort();
        for (const f of files) {
          if (listed.has(f)) continue;
          let title = f.replace(/^\d{3}-/, '').replace(/\.md$/, '');
          let wordCount = 0;
          try {
            const docContent = await fs.readFile(path.join(subdirPath, f), 'utf-8');
            const h1 = docContent.match(/^#\s+(.+)/m);
            if (h1) title = stripMdText(h1[1]);
            wordCount = countWords(docContent);
          } catch {}
          docs.push({ title, filename: f, brief: '', wordCount });
        }
      } catch {}

      subdirs.push({ slug: entry.name, name: entry.name, isGroup: base === GROUPS_DIR || groupSet.has(entry.name), docs });
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

  // 同步 00-index.md：新增文档或标题变化时保证前端列表可见（仅序号命名的文档）
  if (/^\d{3}-.+\.md$/.test(filename)) {
    const h1 = content.match(/^#\s+(.+)/m);
    if (h1) await syncProjectIndex(base, subdir, filename, stripMdText(h1[1]));
  }
}

/** project/groups 子目录的 00-index.md 头部（缺失或为空时用于重建） */
function projectIndexHeader(base: string, subdir: string): string {
  return base === GROUPS_DIR
    ? `# ${subdir} - 分组文档索引`
    : `# ${subdir} - 项目文档索引`;
}

/** 在 00-index.md 文本中 upsert 一条 `- [标题](文件名) - 说明` 条目（保留已有说明） */
function upsertIndexEntry(idx: string, filename: string, title: string, brief: string): string {
  const lines = idx.trimEnd().split('\n');
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(`](${filename})`)) continue;
    const briefMatch = lines[i].match(/\)\s*-\s*(.+)$/);
    lines[i] = `- [${title}](${filename}) - ${briefMatch ? briefMatch[1].trim() : brief}`;
    replaced = true;
    break;
  }
  if (!replaced) {
    // 紧跟 "## 文档列表" 标题追加时保留一个空行，与既有 index 格式一致
    if (lines.length > 0 && lines[lines.length - 1].trim() === '## 文档列表') lines.push('');
    lines.push(`- [${title}](${filename}) - ${brief}`);
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** 同步子目录 00-index.md：缺失/为空时重建头部，然后 upsert 条目（内容无变化则不写盘） */
async function syncProjectIndex(base: string, subdir: string, filename: string, title: string): Promise<void> {
  const indexPath = path.join(base, subdir, '00-index.md');
  let idx = '';
  try {
    idx = await fs.readFile(indexPath, 'utf-8');
  } catch {}
  if (!idx.trim()) {
    idx = `${projectIndexHeader(base, subdir)}\n\n## 文档列表\n`;
  }
  const next = upsertIndexEntry(idx, filename, title, '待补充');
  if (next !== idx) await fs.writeFile(indexPath, next, 'utf-8');
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
  await syncProjectIndex(base, subdir, filename, title);
}

// ---------- 跨分类移动 ----------

export interface MoveResult {
  noop: boolean;
  moved: { from: { category: string; filename: string }; to: { category: string; filename: string } };
  sourceRenames: Record<string, string>; // 源分类：旧文件名 → 新文件名
  targetRenames: Record<string, string>; // 目标分类：旧文件名 → 新文件名
}

/** 分类目录下按文件名排序的文档列表（不含 00-index.md） */
async function listCategoryFiles(category: string): Promise<string[]> {
  const catDir = path.join(CATEGORIES_DIR, category);
  return (await fs.readdir(catDir))
    .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md')
    .sort();
}

/** tags/*.md 中某个题目的条目路径改写：../categories/<oldCat>/<oldFile> → ../categories/<newCat>/<newFile>（兼容 %20 编码形式） */
async function rewriteTagQuestionPath(oldCat: string, oldFile: string, newCat: string, newFile: string): Promise<void> {
  const entries = await fs.readdir(TAGS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const tagPath = path.join(TAGS_DIR, entry.name);
    const content = await fs.readFile(tagPath, 'utf-8');
    let changed = false;
    let next = content;
    for (const [o, n] of [[oldFile, newFile], [encodeURI(oldFile), encodeURI(newFile)]]) {
      if (o === n) continue;
      const oldPath = `../categories/${oldCat}/${o}`;
      const newPath = `../categories/${newCat}/${n}`;
      if (next.includes(oldPath)) {
        next = next.split(oldPath).join(newPath);
        changed = true;
      }
    }
    if (changed) await fs.writeFile(tagPath, next, 'utf-8');
  }
}

/**
 * 全库重写文档间 markdown 引用（不含 wiki 链接——那部分由 updateWikiLinkReferences 负责）：
 * - 跨分类链接 (../<oldCat>/<file>) → (../<newCat>/<file>)，兼容锚点后缀与 %20 编码
 * - 位于 oldCat 目录内的文档中的同目录相对链接 (<file>) → (<newFile>) 或跨分类移动时补 (../<newCat>/<newFile>)
 * renames 按传入顺序依次应用（同分类移动时源映射先于目标映射，链式解析才正确）。
 */
async function rewriteDocReferences(
  renames: { oldCat: string; oldFile: string; newCat: string; newFile: string }[],
): Promise<void> {
  if (renames.length === 0) return;
  const entries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const catDir = path.join(CATEGORIES_DIR, entry.name);
    const files = (await fs.readdir(catDir).catch(() => []))
      .filter((f) => f.match(/^\d{3}-.+\.md$/) && f !== '00-index.md');
    for (const f of files) {
      const filePath = path.join(catDir, f);
      const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
      let changed = false;
      let next = content;
      for (const r of renames) {
        for (const [o, n] of [[r.oldFile, r.newFile], [encodeURI(r.oldFile), encodeURI(r.newFile)]]) {
          if (o === n) continue;
          if (entry.name === r.oldCat) {
            // 同目录相对链接：同分类重排改文件名；跨分类移动的源目录补前缀
            const target = r.oldCat === r.newCat ? n : `../${r.newCat}/${n}`;
            if (next.includes(`](${o}`)) {
              next = next.split(`](${o}`).join(`](${target}`);
              changed = true;
            }
          }
          // 跨分类引用（含锚点，故不要求右括号）
          const crossOld = `](../${r.oldCat}/${o}`;
          if (next.includes(crossOld)) {
            next = next.split(crossOld).join(`](../${r.newCat}/${n}`);
            changed = true;
          }
        }
      }
      if (changed) await writeFileWithBackup(path.join('categories', entry.name), f, next);
    }
  }
}

/**
 * 把一道题从 from 分类移动到 to 分类的 toIndex 槽位（toIndex 为「移除该题后」目标列表中的
 * 0-based 插入下标，由前端在拖拽落点时计算；等于列表长度表示追加到末尾）。
 *
 * 移动引发的联动：源目录后续序号 -1、目标目录插入位及之后序号 +1、两侧 00-index.md 重建、
 * 两侧导航链重建、tags/*.md 条目改写、全库 wiki 链接与跨分类 markdown 链接改写、
 * link-meta 与 annotations 侧车改名、所有被改写文件先备份。
 */
export async function moveCategoryQuestion(
  from: string,
  filename: string,
  to: string,
  toIndex: number,
): Promise<MoveResult> {
  const fromDir = path.join(CATEGORIES_DIR, from);
  const toDir = path.join(CATEGORIES_DIR, to);

  const slug = filename.replace(/^\d{3}-/, '').replace(/\.md$/, '');
  const srcList = await listCategoryFiles(from);
  const originalIndex = srcList.indexOf(filename);
  if (originalIndex < 0) throw new Error(`源文档不存在: ${from}/${filename}`);

  // 同分类且落点等于原位（或原位的相邻空隙）→ 无需移动
  if (from === to && Math.round(toIndex) === originalIndex) {
    return {
      noop: true,
      moved: { from: { category: from, filename }, to: { category: to, filename } },
      sourceRenames: {},
      targetRenames: {},
    };
  }

  // 内容提前读入内存，之后的改写全部在内存完成再落盘
  let content = await fs.readFile(path.join(fromDir, filename), 'utf-8');

  // 强制备份被移文档原文（newContent 传空串避免与旧内容相等而跳过；删除类操作原本无备份）
  await backupBeforeWrite(path.join('categories', from), filename, '');

  // 临时移出被移文档与 annotations 侧车（文件名不匹配 ^\d{3}-，对所有读取器不可见）。
  // 关键：Windows 上 fs.rename 会覆盖同名目标文件，若被移文档留在源目录参与降序改名会被覆盖。
  const stamp = Date.now();
  const tmpFile = `.pending-move-${stamp}.md`;
  const tmpAnn = `.pending-move-${stamp}-annotations.json`;
  await fs.rename(path.join(fromDir, filename), path.join(fromDir, tmpFile));
  await fs.rename(path.join(fromDir, `${filename.slice(0, 3)}-annotations.json`), path.join(fromDir, tmpAnn)).catch(() => {});

  const rollback = async () => {
    await fs.rename(path.join(fromDir, tmpFile), path.join(fromDir, filename)).catch(() => {});
    await fs.rename(path.join(fromDir, tmpAnn), path.join(fromDir, `${filename.slice(0, 3)}-annotations.json`)).catch(() => {});
  };

  try {
    // 1. 源目录重排（内部已联动 index/tags/wiki/link-meta/导航链）
    const sourceMap = await renumberCategoryAfterDelete(from, filename);

    // 2. 目标目录：插入槽位 → targetSeq；插入位及之后文件序号 +1
    const targetList = await listCategoryFiles(to);
    const idx = Math.max(0, Math.min(Math.round(toIndex), targetList.length));
    const targetSeq = idx < targetList.length
      ? parseInt(targetList[idx].slice(0, 3), 10)
      : (await getMaxSequence(to)) + 1;

    const shiftMap = new Map<string, string>();
    for (const f of targetList) {
      const m = f.match(/^(\d{3})-/);
      if (!m) continue;
      const seq = parseInt(m[1], 10);
      if (seq >= targetSeq) shiftMap.set(f, f.replace(/^\d{3}/, String(seq + 1).padStart(3, '0')));
    }
    const newFilename = `${String(targetSeq).padStart(3, '0')}-${slug}.md`;

    // 3. 在内存中改写被移文档内容：
    // a. 源目录重排映射（导航/正文引用/wiki 引用）
    content = applyRenameMapsToContent(content, sourceMap);
    // b. 目标目录 shift 映射（被移文档对目标文档的引用）
    content = applyRenameMapsToContent(content, shiftMap);
    // c. 被移文档自身旧文件名的引用 → 新文件名（进入目标目录后的同目录形式）
    content = applyRenameMapsToContent(content, new Map([[filename, newFilename]]));
    // d. 指向源目录文档的同目录相对链接 → 补跨目录前缀
    for (const f of await listCategoryFiles(from)) {
      if (content.includes(`](${f}`)) content = content.split(`](${f}`).join(`](../${from}/${f}`);
      const enc = encodeURI(f);
      if (enc !== f && content.includes(`](${enc}`)) content = content.split(`](${enc}`).join(`](../${from}/${enc}`);
    }
    // e. 图片引用 → 指向源分类（raw 路由的 path.resolve 会规范化 ../）
    content = content.split('](images/').join(`](../${from}/images/`);
    content = content.split('src="images/').join(`src="../${from}/images/`);

    // 4. 目标目录重命名（降序防覆盖）+ 侧车改名 + 被 shift 文件内部引用改写
    const sortedShift = [...shiftMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    for (const [oldName, newName] of sortedShift) {
      await fs.rename(path.join(toDir, oldName), path.join(toDir, newName));
    }
    for (const [oldName, newName] of shiftMap.entries()) {
      // annotations 侧车（实际命名为 <seq>-annotations.json）
      try {
        await fs.rename(
          path.join(toDir, `${oldName.slice(0, 3)}-annotations.json`),
          path.join(toDir, `${newName.slice(0, 3)}-annotations.json`),
        );
      } catch {}
      // link-meta 侧车
      try {
        await fs.rename(
          path.join(LINK_META_DIR, `category--${to}--${oldName}.json`),
          path.join(LINK_META_DIR, `category--${to}--${newName}.json`),
        );
      } catch {}
    }
    for (const [oldName, newName] of shiftMap.entries()) {
      const filePath = path.join(toDir, newName);
      const c = await fs.readFile(filePath, 'utf-8');
      const next = applyRenameMapsToContent(c, shiftMap);
      if (next !== c) await writeFileWithBackup(path.join('categories', to), newName, next);
    }

    // 5. 被移文档落盘 + annotations/link-meta 侧车跨目录改名 + 清理临时文件
    await fs.writeFile(path.join(toDir, newFilename), content, 'utf-8');
    await fs.unlink(path.join(fromDir, tmpFile)).catch(() => {});
    try {
      await fs.rename(path.join(fromDir, tmpAnn), path.join(toDir, `${newFilename.slice(0, 3)}-annotations.json`));
    } catch {}
    try {
      await fs.rename(
        path.join(LINK_META_DIR, `category--${from}--${filename}.json`),
        path.join(LINK_META_DIR, `category--${to}--${newFilename}.json`),
      );
    } catch {}

    // 6. 重建目标 index 与导航链（导航链必须在全部改名完成后执行）
    await rebuildCategoryIndex(to);
    await fixNavigationChain(to);

    // 7. 全局引用改写（顺序：源映射 → 目标映射 → 被移文档对，同分类链式重排时才解析正确）
    await updateTagReferences(sourceMap);
    await updateTagReferences(shiftMap);
    await rewriteTagQuestionPath(from, filename, to, newFilename);
    await updateWikiLinkReferences(from, sourceMap);
    await updateWikiLinkReferences(to, shiftMap);
    await updateWikiLinkReferences(to, new Map([[filename, newFilename]]));
    await rewriteDocReferences([
      ...[...sourceMap.entries()].map(([oldFile, newFile]) => ({ oldCat: from, oldFile, newCat: from, newFile })),
      ...[...shiftMap.entries()].map(([oldFile, newFile]) => ({ oldCat: to, oldFile, newCat: to, newFile })),
      { oldCat: from, oldFile: filename, newCat: to, newFile: newFilename },
    ]);

    return {
      noop: false,
      moved: { from: { category: from, filename }, to: { category: to, filename: newFilename } },
      sourceRenames: Object.fromEntries(sourceMap),
      targetRenames: Object.fromEntries(shiftMap),
    };
  } catch (e) {
    // 尽力回滚被移文档；源目录已完成的重排内部自洽，不回退
    await rollback();
    throw e;
  }
}

/** project/groups 子目录下按文件名排序的文档列表（不含 00-index.md）。 */
async function listProjectSubdirFiles(subdir: string): Promise<{ base: string; files: string[] }> {
  if (!subdir || path.basename(subdir) !== subdir || subdir === '.' || subdir === '..') {
    throw new Error('子目录名称不合法');
  }
  const base = await resolveSubdirBase(subdir);
  const files = (await fs.readdir(path.join(base, subdir)))
    .filter((file) => file.match(/^\d{3}-.+\.md$/) && file !== '00-index.md')
    .sort();
  return { base, files };
}

/** 全库改写指向被移动 project/分组文档的普通 Markdown 相对链接。 */
async function rewriteMovedProjectDocReferences(oldFilePath: string, newFilePath: string): Promise<void> {
  const normalizedOldPath = path.normalize(oldFilePath).toLowerCase();
  for (const root of [CATEGORIES_DIR, PROJECT_DIR, GROUPS_DIR]) {
    const directories = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const directoryPath = path.join(root, directory.name);
      const files = await fs.readdir(directoryPath).catch(() => []);
      for (const file of files) {
        if (!file.match(/^\d{3}-.+\.md$/) || file === '00-index.md') continue;
        const currentFilePath = path.join(directoryPath, file);
        const content = await fs.readFile(currentFilePath, 'utf-8');
        let changed = false;
        const updated = content.replace(/\]\(([^)#]+)(#[^)]*)?\)/g, (match, rawTarget: string, anchor = '') => {
          if (/^[a-z]+:/i.test(rawTarget) || rawTarget.startsWith('/')) return match;
          let decodedTarget = rawTarget;
          try { decodedTarget = decodeURI(rawTarget); } catch {}
          const resolvedTarget = path.normalize(path.resolve(directoryPath, decodedTarget)).toLowerCase();
          if (resolvedTarget !== normalizedOldPath) return match;
          const relativeTarget = path.relative(directoryPath, newFilePath).replace(/\\/g, '/');
          changed = true;
          return `](${rawTarget.includes('%') ? encodeURI(relativeTarget) : relativeTarget}${anchor})`;
        });
        if (changed) {
          await writeFileWithBackup(path.join(path.relative(PROJECT_ROOT, root), directory.name), file, updated);
        }
      }
    }
  }
}

/**
 * 在 project 与 groups 的子目录之间移动文档；该移动域与分类文档完全隔离。
 * 序号、索引、导航、annotations、link-meta 和 wiki 引用随移动结果同步更新。
 */
export async function moveProjectDoc(
  from: string,
  filename: string,
  to: string,
  toIndex: number,
): Promise<MoveResult> {
  const source = await listProjectSubdirFiles(from);
  const originalIndex = source.files.indexOf(filename);
  if (originalIndex < 0) throw new Error(`源文档不存在: ${from}/${filename}`);

  const target = await listProjectSubdirFiles(to);
  if (from === to && Math.round(toIndex) === originalIndex) {
    return {
      noop: true,
      moved: { from: { category: from, filename }, to: { category: to, filename } },
      sourceRenames: {},
      targetRenames: {},
    };
  }

  const fromDir = path.join(source.base, from);
  const toDir = path.join(target.base, to);
  const sourceRelDir = path.join(path.relative(PROJECT_ROOT, source.base), from);
  const targetRelDir = path.join(path.relative(PROJECT_ROOT, target.base), to);
  const slug = filename.replace(/^\d{3}-/, '').replace(/\.md$/, '');
  let content = await fs.readFile(path.join(fromDir, filename), 'utf-8');

  // 移动前备份原文，便于恢复误操作。
  await backupBeforeWrite(sourceRelDir, filename, '');
  const stamp = Date.now();
  const tempFile = `.pending-project-move-${stamp}.md`;
  const tempAnnotations = `.pending-project-move-${stamp}-annotations.json`;
  const tempLinkMeta = `.pending-project-move-${stamp}-link-meta.json`;
  await fs.rename(path.join(fromDir, filename), path.join(fromDir, tempFile));
  await fs.rename(
    path.join(fromDir, `${filename.slice(0, 3)}-annotations.json`),
    path.join(fromDir, tempAnnotations),
  ).catch(() => {});
  await fs.rename(
    path.join(LINK_META_DIR, `project--${from}--${filename}.json`),
    path.join(LINK_META_DIR, tempLinkMeta),
  ).catch(() => {});

  const rollback = async () => {
    await fs.rename(path.join(fromDir, tempFile), path.join(fromDir, filename)).catch(() => {});
    await fs.rename(
      path.join(fromDir, tempAnnotations),
      path.join(fromDir, `${filename.slice(0, 3)}-annotations.json`),
    ).catch(() => {});
    await fs.rename(
      path.join(LINK_META_DIR, tempLinkMeta),
      path.join(LINK_META_DIR, `project--${from}--${filename}.json`),
    ).catch(() => {});
  };

  try {
    // 源目录先收紧序号，再按目标落点为已有文档腾出序号。
    const sourceMap = await renumberProjectSubdirAfterDelete(from, filename);
    const targetFiles = (await listProjectSubdirFiles(to)).files;
    const index = Math.max(0, Math.min(Math.round(toIndex), targetFiles.length));
    const targetSequence = index < targetFiles.length
      ? parseInt(targetFiles[index].slice(0, 3), 10)
      : (targetFiles.length > 0 ? Math.max(...targetFiles.map((file) => parseInt(file.slice(0, 3), 10))) + 1 : 1);
    const shiftMap = new Map<string, string>();
    for (const file of targetFiles) {
      const sequence = parseInt(file.slice(0, 3), 10);
      if (sequence >= targetSequence) {
        shiftMap.set(file, file.replace(/^\d{3}/, String(sequence + 1).padStart(3, '0')));
      }
    }
    const newFilename = `${String(targetSequence).padStart(3, '0')}-${slug}.md`;

    content = applyRenameMapsToContent(content, sourceMap);
    content = applyRenameMapsToContent(content, shiftMap);
    content = applyRenameMapsToContent(content, new Map([[filename, newFilename]]));

    // 跨目录后，把原同目录相对链接和 images 路径改成从目标目录出发的相对路径。
    if (from !== to || source.base !== target.base) {
      for (const sourceFile of (await listProjectSubdirFiles(from)).files) {
        const relativeFile = path.relative(toDir, path.join(fromDir, sourceFile)).replace(/\\/g, '/');
        for (const [oldPath, newPath] of [[sourceFile, relativeFile], [encodeURI(sourceFile), encodeURI(relativeFile)]]) {
          if (content.includes(`](${oldPath}`)) content = content.split(`](${oldPath}`).join(`](${newPath}`);
        }
      }
      const relativeImages = path.relative(toDir, path.join(fromDir, 'images')).replace(/\\/g, '/');
      content = content.split('](images/').join(`](${relativeImages}/`);
      content = content.split('src="images/').join(`src="${relativeImages}/`);
    }

    const sortedShift = [...shiftMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    for (const [oldName, newName] of sortedShift) {
      await fs.rename(path.join(toDir, oldName), path.join(toDir, newName));
    }
    for (const [oldName, newName] of shiftMap.entries()) {
      await fs.rename(
        path.join(toDir, `${oldName.slice(0, 3)}-annotations.json`),
        path.join(toDir, `${newName.slice(0, 3)}-annotations.json`),
      ).catch(() => {});
      await fs.rename(
        path.join(LINK_META_DIR, `project--${to}--${oldName}.json`),
        path.join(LINK_META_DIR, `project--${to}--${newName}.json`),
      ).catch(() => {});
    }
    for (const [, newName] of shiftMap.entries()) {
      const filePath = path.join(toDir, newName);
      const oldContent = await fs.readFile(filePath, 'utf-8');
      const updatedContent = applyRenameMapsToContent(oldContent, shiftMap);
      if (updatedContent !== oldContent) await writeFileWithBackup(targetRelDir, newName, updatedContent);
    }

    await fs.writeFile(path.join(toDir, newFilename), content, 'utf-8');
    await fs.unlink(path.join(fromDir, tempFile)).catch(() => {});
    await fs.rename(
      path.join(fromDir, tempAnnotations),
      path.join(toDir, `${newFilename.slice(0, 3)}-annotations.json`),
    ).catch(() => {});
    await fs.rename(
      path.join(LINK_META_DIR, tempLinkMeta),
      path.join(LINK_META_DIR, `project--${to}--${newFilename}.json`),
    ).catch(() => {});

    await rebuildSubdirIndex(target.base, to);
    await fixNavigationChainInDir(toDir, targetRelDir);
    await updateWikiLinkReferences(from, sourceMap);
    await updateWikiLinkReferences(to, shiftMap);
    await updateWikiLinkReferences(to, new Map([[filename, newFilename]]));
    await rewriteMovedProjectDocReferences(path.join(fromDir, filename), path.join(toDir, newFilename));

    return {
      noop: false,
      moved: { from: { category: from, filename }, to: { category: to, filename: newFilename } },
      sourceRenames: Object.fromEntries(sourceMap),
      targetRenames: Object.fromEntries(shiftMap),
    };
  } catch (error) {
    await rollback();
    throw error;
  }
}




