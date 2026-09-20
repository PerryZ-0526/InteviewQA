import fs from 'fs/promises';
import path from 'path';
import {
  PROJECT_ROOT,
  categoryExists,
  createCategory,
  fixNavigationChain,
  getMaxSequence,
  rebuildCategoryIndex,
} from './fileUtils';
import { formatDateTime } from './markdown';
import { assertSafePathSegment } from './safePath';
import { stripMdText } from './stripText';

const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const TAGS_DIR = path.join(PROJECT_ROOT, 'tags');
const README_PATH = path.join(PROJECT_ROOT, 'README.md');

let mutationQueue: Promise<unknown> = Promise.resolve();

function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation, operation);
  mutationQueue = run.catch(() => {});
  return run;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

function slugifyTitle(title: string): string {
  const slug = stripMdText(title)
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120)
    .trim();
  if (!slug) throw new Error('无法从标题生成文件名');
  return slug;
}

function replaceOrInsertSection(content: string, heading: string, body: string, beforeHeading?: string): string {
  const section = new RegExp(`(^|\\n)## ${heading}\\s*\\n[\\s\\S]*?(?=\\n## |\\n<!-- |$)`);
  if (section.test(content)) {
    return content.replace(section, (_match, prefix) => `${prefix}## ${heading}\n\n${body}\n`);
  }
  const block = `## ${heading}\n\n${body}\n\n`;
  if (beforeHeading && content.includes(`## ${beforeHeading}`)) {
    return content.replace(`## ${beforeHeading}`, `${block}## ${beforeHeading}`);
  }
  return `${content.trimEnd()}\n\n${block}`;
}

function normalizeGeneratedContent(content: string, tags: string[]): { content: string; title: string } {
  let normalized = content.trim().replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '');
  const title = stripMdText(normalized.match(/^#\s+(.+)/m)?.[1] || '');
  if (!title || !normalized.includes('## 题目')) {
    throw new Error('AI 输出缺少 H1 标题或“题目”章节');
  }

  const tagLinks = tags.map((tag) => `[${tag}](../../tags/${tag}.md)`).join(' | ') || '暂无';
  normalized = replaceOrInsertSection(normalized, '标签', tagLinks, '题目导航');
  normalized = replaceOrInsertSection(normalized, '题目导航', '← 无 | 无 →', '面试直接答');
  normalized = normalized.replace(/\n?<!--\s*(?:created|updated):[\s\S]*?-->\s*/g, '\n').trimEnd();
  const now = formatDateTime(new Date());
  normalized += `\n\n<!-- created: ${now} -->\n<!-- updated: ${now} -->\n`;
  return { content: normalized, title };
}

async function upsertTag(tag: string, category: string, filename: string, title: string): Promise<void> {
  assertSafePathSegment(tag, '标签名');
  await fs.mkdir(TAGS_DIR, { recursive: true });
  const tagPath = path.join(TAGS_DIR, `${tag}.md`);
  const link = `- [${title}](../categories/${category}/${filename})`;
  const current = await fs.readFile(tagPath, 'utf8').catch(() => `# ${tag}\n\n## 相关题目\n`);
  if (!current.includes(`](../categories/${category}/${filename})`)) {
    await writeAtomic(tagPath, `${current.trimEnd()}\n${link}\n`);
  }
}

async function updateReadme(category: string, displayName: string, tags: string[]): Promise<void> {
  let readme = await fs.readFile(README_PATH, 'utf8');
  const categoryPath = `categories/${category}/00-index.md`;
  if (!readme.includes(`](${categoryPath})`) && !readme.includes(`](categories/${encodeURIComponent(category)}/00-index.md)`)) {
    const line = `- [${displayName}](${categoryPath})`;
    if (readme.includes('### 其他')) {
      readme = readme.replace(/(### 其他\s*\n)/, `$1\n${line}\n`);
    } else {
      readme = readme.replace('\n## 标签', `\n### 其他\n\n${line}\n\n## 标签`);
    }
  }

  const newTagLines = tags
    .filter((tag) => !readme.includes(`](tags/${tag}.md)`))
    .map((tag) => `- [${tag}](tags/${tag}.md)`);
  if (newTagLines.length > 0) {
    readme = readme.replace('\n## 项目文档', `\n${newTagLines.join('\n')}\n\n## 项目文档`);
  }
  await writeAtomic(README_PATH, readme);
}

export interface GeneratedQuestion {
  category: string;
  categoryDisplayName?: string;
  tags: string[];
  content: string;
}

export async function createGeneratedQuestion(input: GeneratedQuestion): Promise<{ category: string; filename: string; content: string }> {
  return withMutationLock(async () => {
    const category = input.category.trim();
    assertSafePathSegment(category, '分类名');
    const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
    tags.forEach((tag) => assertSafePathSegment(tag, '标签名'));

    const existed = await categoryExists(category);
    if (!existed) await createCategory(category, input.categoryDisplayName?.trim() || category);

    const normalized = normalizeGeneratedContent(input.content, tags);
    let sequence = (await getMaxSequence(category)) + 1;
    let filename = `${String(sequence).padStart(3, '0')}-${slugifyTitle(normalized.title)}.md`;
    while (await fs.access(path.join(CATEGORIES_DIR, category, filename)).then(() => true).catch(() => false)) {
      sequence += 1;
      filename = `${String(sequence).padStart(3, '0')}-${slugifyTitle(normalized.title)}.md`;
    }

    const filePath = path.join(CATEGORIES_DIR, category, filename);
    await writeAtomic(filePath, normalized.content);
    await rebuildCategoryIndex(category);
    await fixNavigationChain(category);
    await Promise.all(tags.map((tag) => upsertTag(tag, category, filename, normalized.title)));
    await updateReadme(category, input.categoryDisplayName?.trim() || category, tags);

    return { category, filename, content: await fs.readFile(filePath, 'utf8') };
  });
}
