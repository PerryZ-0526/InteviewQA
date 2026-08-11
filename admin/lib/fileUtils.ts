import fs from 'fs/promises';
import path from 'path';

// 项目根目录（admin/.. 即 InteviewQA/）
export const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const TAGS_DIR = path.join(PROJECT_ROOT, 'tags');
const PROJECT_DIR = path.join(PROJECT_ROOT, 'project');

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
      try {
        const content = await fs.readFile(path.join(categoryPath, f), 'utf-8');
        const h1 = content.match(/^#\s+(.+)/m);
        if (h1) title = h1[1].trim();
      } catch {}
      questions.push({ filename: f, title });
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

/**
 * 获取 project/ 目录下的所有子目录及其文档列表（结构等同于 categories）
 */
export async function listProjectDocs() {
  const entries = await fs.readdir(PROJECT_DIR, { withFileTypes: true });
  const subdirs: { slug: string; name: string; docs: { filename: string; title: string; brief: string }[] }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdirPath = path.join(PROJECT_DIR, entry.name);
    const indexPath = path.join(subdirPath, '00-index.md');
    const docs: { filename: string; title: string; brief: string }[] = [];

    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const displayName = content.match(/^#\s+(.+?)\s*[-–—]/m)?.[1]?.trim() || entry.name;
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*-\s*(.+)/);
        if (match) {
          // 从实际文件 H1 读取标题（与 categories 一致），index 条目文本仅作 fallback
          let title = match[1];
          try {
            const docContent = await fs.readFile(path.join(subdirPath, match[2]), 'utf-8');
            const h1 = docContent.match(/^#\s+(.+)/m);
            if (h1) title = h1[1].trim();
          } catch {}
          docs.push({ title, filename: match[2], brief: match[3] });
        }
      }
      subdirs.push({ slug: entry.name, name: displayName, docs });
    } catch {}
  }

  return subdirs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * 读取 project/<subdir>/ 下的一篇文档
 */
export async function readProjectDoc(subdir: string, filename: string): Promise<string | null> {
  try {
    const filePath = path.join(PROJECT_DIR, subdir, filename);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeProjectDoc(subdir: string, filename: string, content: string): Promise<void> {
  const filePath = path.join(PROJECT_DIR, subdir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
}

/** 创建新分类目录 + 00-index.md */
export async function createCategory(slug: string, displayName: string): Promise<void> {
  const dirPath = path.join(CATEGORIES_DIR, slug);
  await fs.mkdir(dirPath, { recursive: true });
  const indexContent = `# ${displayName} - 题目索引\n\n## 题目列表\n\n`;
  await fs.writeFile(path.join(dirPath, '00-index.md'), indexContent, 'utf-8');
}

/** 获取分类/project子目录下的最大序号 */
export async function getProjectMaxSequence(subdir: string): Promise<number> {
  const dirPath = path.join(PROJECT_DIR, subdir);
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

/** 在 project 子目录下创建文档 */
export async function createProjectDocFile(subdir: string, filename: string, title: string): Promise<void> {
  const filePath = path.join(PROJECT_DIR, subdir, filename);
  const content = `# ${title}\n\n`;
  await fs.writeFile(filePath, content, 'utf-8');

  // 更新 00-index.md
  const indexPath = path.join(PROJECT_DIR, subdir, '00-index.md');
  let idx = await fs.readFile(indexPath, 'utf-8');
  idx = idx.trimEnd() + `\n- [${title}](${filename}) - 待补充\n`;
  await fs.writeFile(indexPath, idx, 'utf-8');
}

/** 创建顶层分组（与 categories/project 同级） */
export async function createSection(slug: string, displayName: string): Promise<void> {
  const sectionPath = path.join(PROJECT_ROOT, slug);
  await fs.mkdir(sectionPath, { recursive: true });
  const subdirPath = path.join(sectionPath, 'docs');
  await fs.mkdir(subdirPath, { recursive: true });
  const indexContent = `# ${displayName} - 索引\n\n## 文档列表\n\n`;
  await fs.writeFile(path.join(subdirPath, '00-index.md'), indexContent, 'utf-8');
}
