import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const categoriesRoot = path.join(root, 'categories');
const errors = [];
const warnings = [];

function directories(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
}

function questionFiles(dir) {
  return fs.readdirSync(dir).filter((name) => /^\d{3}-.+\.md$/u.test(name)).sort();
}

function linkLabel(filename) {
  return filename.replace(/^\d{3}-/, '').replace(/\.md$/, '');
}

function parseTags(content) {
  const section = content.match(/(?:^|\n)## 标签\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)/)?.[1] || '';
  return [...section.matchAll(/\[([^\]]+)\]\([^)]+\)/g)].map((match) => match[1]);
}

function parseIndexFiles(content) {
  return [...content.matchAll(/^- \[[^\]]+\]\(([^)#]+\.md)(?:#[^)]*)?\)/gm)].map((match) => match[1]);
}

const expectedTagLinks = new Map();
for (const slug of directories(categoriesRoot)) {
  const dir = path.join(categoriesRoot, slug);
  const files = questionFiles(dir);
  const indexPath = path.join(dir, '00-index.md');
  if (!fs.existsSync(indexPath)) {
    errors.push(`${path.relative(root, dir)} 缺少 00-index.md`);
  } else {
    const indexed = parseIndexFiles(fs.readFileSync(indexPath, 'utf8'));
    for (const filename of files.filter((name) => !indexed.includes(name))) {
      errors.push(`${path.relative(root, indexPath)} 缺少 ${filename}`);
    }
    for (const filename of indexed.filter((name) => !files.includes(name))) {
      errors.push(`${path.relative(root, indexPath)} 指向不存在的 ${filename}`);
    }
  }

  const duplicateSequences = new Map();
  files.forEach((filename) => {
    const sequence = filename.slice(0, 3);
    duplicateSequences.set(sequence, [...(duplicateSequences.get(sequence) || []), filename]);
  });
  for (const [sequence, names] of duplicateSequences) {
    if (names.length > 1) errors.push(`${slug} 存在重复序号 ${sequence}: ${names.join(', ')}`);
  }

  files.forEach((filename, index) => {
    const filePath = path.join(dir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const heading of ['题目', '标签', '题目导航']) {
      if (!content.includes(`## ${heading}`)) errors.push(`${path.relative(root, filePath)} 缺少“${heading}”章节`);
    }
    if (!/<!--\s*created:/.test(content) || !/<!--\s*updated:/.test(content)) {
      warnings.push(`${path.relative(root, filePath)} 缺少完整时间元数据`);
    }

    const prev = index > 0 ? `← [${linkLabel(files[index - 1])}](${files[index - 1]})` : '← 无';
    const next = index < files.length - 1 ? `[${linkLabel(files[index + 1])}](${files[index + 1]}) →` : '无 →';
    const expected = `${prev} | ${next}`;
    const actual = content.match(/## 题目导航\s*\n\s*([^\n]+)/)?.[1]?.trim();
    if (actual !== expected) errors.push(`${path.relative(root, filePath)} 导航链不一致`);

    for (const tag of parseTags(content)) {
      if (tag === 'TODO') {
        warnings.push(`${path.relative(root, filePath)} 仍使用 TODO 标签`);
        continue;
      }
      const target = `../categories/${slug}/${filename}`;
      expectedTagLinks.set(tag, [...(expectedTagLinks.get(tag) || []), target]);
    }
  });
}

for (const [tag, links] of expectedTagLinks) {
  const tagPath = path.join(root, 'tags', `${tag}.md`);
  if (!fs.existsSync(tagPath)) {
    errors.push(`缺少标签索引 tags/${tag}.md`);
    continue;
  }
  const content = fs.readFileSync(tagPath, 'utf8');
  links.forEach((link) => {
    if (!content.includes(`](${link})`)) errors.push(`tags/${tag}.md 缺少 ${link}`);
  });
}
for (const filename of fs.readdirSync(path.join(root, 'tags')).filter((name) => name.endsWith('.md'))) {
  const tag = filename.slice(0, -3);
  const expected = new Set(expectedTagLinks.get(tag) || []);
  const actual = [...fs.readFileSync(path.join(root, 'tags', filename), 'utf8')
    .matchAll(/\]\((\.\.\/categories\/[^)]+\.md)\)/g)]
    .map((match) => match[1]);
  for (const link of actual) {
    if (!expected.has(link)) errors.push(`tags/${filename} 含无效或多余条目 ${link}`);
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (readme.includes('${category}')) errors.push('README.md 含未展开的 ${category} 模板');
const actualCategories = new Set(directories(categoriesRoot));
for (const slug of actualCategories) {
  const encoded = encodeURIComponent(slug).replace(/%2F/gi, '/');
  if (!readme.includes(`categories/${slug}/00-index.md`) && !readme.includes(`categories/${encoded}/00-index.md`)) {
    errors.push(`README.md 缺少分类 ${slug}`);
  }
}
const listedCategories = new Set(
  [...readme.matchAll(/\(categories\/([^/)]+)\/00-index\.md\)/g)]
    .map((match) => decodeURIComponent(match[1])),
);
for (const slug of listedCategories) {
  if (!actualCategories.has(slug)) errors.push(`README.md 指向不存在的分类 ${slug}`);
}
const listedTags = new Set([...readme.matchAll(/\(tags\/([^)]+)\.md\)/g)].map((match) => match[1]));
const actualTags = new Set(
  fs.readdirSync(path.join(root, 'tags')).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)),
);
for (const tag of actualTags) {
  if (!listedTags.has(tag)) errors.push(`README.md 缺少标签 ${tag}`);
}
for (const tag of listedTags) {
  if (!actualTags.has(tag)) errors.push(`README.md 指向不存在的标签 ${tag}`);
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
console.log(`content validation: ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length > 0) process.exitCode = 1;
