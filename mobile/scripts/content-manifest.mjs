import fs from 'fs';
import path from 'path';
import { parseIndex, parseQuestion } from '../src/content.js';

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8');
}

function listDirectories(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function listMarkdownDocuments(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => /^\d{3}-.+\.md$/.test(name))
    .sort();
}

function titleFromMarkdown(markdown, fallback) {
  return markdown.match(/^#\s+(.+)/m)?.[1]?.trim() || fallback;
}

export function buildContentManifest(projectRoot) {
  const categories = [];
  const tagMap = new Map();
  const categoryRoot = path.join(projectRoot, 'categories');

  for (const slug of listDirectories(categoryRoot)) {
    const dir = path.join(categoryRoot, slug);
    const indexPath = path.join(dir, '00-index.md');
    const index = fs.existsSync(indexPath) ? readUtf8(indexPath) : '';
    const name = index.match(/^#\s+(.+?)\s*[-–—]/m)?.[1]?.trim() || slug;
    const questions = listMarkdownDocuments(dir).map((filename) => {
      const question = parseQuestion(readUtf8(path.join(dir, filename)), filename);
      for (const tag of question.tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag).push({ filename, title: question.title, category: slug });
      }
      return {
        filename,
        title: question.title,
        question: question.question,
        tags: question.tags,
      };
    });
    categories.push({ slug, name, questions });
  }

  const projectDocs = [];
  for (const base of ['project', 'groups']) {
    const baseRoot = path.join(projectRoot, base);
    for (const subdir of listDirectories(baseRoot)) {
      const dir = path.join(baseRoot, subdir);
      const indexPath = path.join(dir, '00-index.md');
      const indexEntries = fs.existsSync(indexPath) ? parseIndex(readUtf8(indexPath)) : [];
      const indexByFilename = new Map(indexEntries.map((entry) => [entry.filename, entry]));
      for (const filename of listMarkdownDocuments(dir)) {
        const content = readUtf8(path.join(dir, filename));
        const indexed = indexByFilename.get(filename);
        projectDocs.push({
          filename,
          title: titleFromMarkdown(content, indexed?.title || filename),
          brief: indexed?.brief || '',
          subdir,
          base,
        });
      }
    }
  }

  const tags = [...tagMap.entries()]
    .map(([name, questions]) => ({ name, questions }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    categories,
    tags,
    projectDocs,
  };
}
