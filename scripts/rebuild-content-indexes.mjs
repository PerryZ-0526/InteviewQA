import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const categoriesRoot = path.join(root, 'categories');
const tagsRoot = path.join(root, 'tags');
const categoryNames = new Map();

function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

function directories(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function questionFiles(dir) {
  return fs.readdirSync(dir).filter((name) => /^\d{3}-.+\.md$/u.test(name)).sort();
}

function stripFormatting(value) {
  return value.replace(/<[^>]+>/g, '').replace(/[*_~`]/g, '').trim();
}

function titleOf(content, filename) {
  return stripFormatting(content.match(/^#\s+(.+)/m)?.[1] || filename.replace(/^\d{3}-/, '').replace(/\.md$/, ''));
}

function parseTags(content) {
  const section = content.match(/(?:^|\n)## 标签\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)/)?.[1] || '';
  return [...section.matchAll(/\[([^\]]+)\]\([^)]+\)/g)]
    .map((match) => match[1])
    .filter((tag) => tag !== 'TODO');
}

const tagEntries = new Map();
for (const category of directories(categoriesRoot)) {
  const dir = path.join(categoriesRoot, category);
  const files = questionFiles(dir);
  const indexPath = path.join(dir, '00-index.md');
  const oldIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  const heading = oldIndex.match(/^#\s+.+$/m)?.[0] || `# ${category} - 题目索引`;
  const displayName = stripFormatting(heading.replace(/^#\s+/, '').split(/\s+[-–—]\s+/)[0] || category);
  categoryNames.set(category, displayName);
  const briefs = new Map(
    [...oldIndex.matchAll(/^- \[[^\]]+\]\(([^)#]+\.md)(?:#[^)]*)?\)(?:\s*-\s*(.*))?$/gm)]
      .map((match) => [match[1], match[2] || '待补充']),
  );
  const indexLines = [];

  files.forEach((filename, index) => {
    const filePath = path.join(dir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const title = titleOf(content, filename);
    const previous = index > 0 ? files[index - 1] : null;
    const next = index < files.length - 1 ? files[index + 1] : null;
    const label = (name) => name.replace(/^\d{3}-/, '').replace(/\.md$/, '');
    const nav = `${previous ? `← [${label(previous)}](${previous})` : '← 无'} | ${next ? `[${label(next)}](${next}) →` : '无 →'}`;
    const updated = content.replace(
      /## 题目导航\r?\n\r?\n[\s\S]*?(?=\r?\n## |\r?\n<!-- )/,
      `## 题目导航\n\n${nav}\n`,
    );
    if (updated !== content) writeAtomic(filePath, updated);

    indexLines.push(`- [${title}](${filename}) - ${briefs.get(filename) || title.slice(0, 30)}`);
    for (const tag of parseTags(updated)) {
      if (/[\/\\\0]/.test(tag)) throw new Error(`标签名不合法: ${tag}`);
      tagEntries.set(tag, [...(tagEntries.get(tag) || []), { title, category, filename }]);
    }
  });

  writeAtomic(indexPath, `${heading}\n\n## 题目列表\n${indexLines.length ? `\n${indexLines.join('\n')}\n` : ''}`);
}

fs.mkdirSync(tagsRoot, { recursive: true });
for (const file of fs.readdirSync(tagsRoot)) {
  if (file.endsWith('.md')) fs.unlinkSync(path.join(tagsRoot, file));
}
for (const [tag, entries] of [...tagEntries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const groups = new Map();
  entries
    .sort((a, b) => `${a.category}/${a.filename}`.localeCompare(`${b.category}/${b.filename}`))
    .forEach((entry) => groups.set(entry.category, [...(groups.get(entry.category) || []), entry]));
  const sections = [...groups.entries()].map(([category, categoryEntries]) => {
    const lines = categoryEntries.map((entry) => `- [${entry.title}](../categories/${entry.category}/${entry.filename})`);
    return `### ${categoryNames.get(category) || category}\n\n${lines.join('\n')}`;
  });
  writeAtomic(path.join(tagsRoot, `${tag}.md`), `# ${tag}\n\n## 相关题目\n\n${sections.join('\n\n')}\n`);
}

const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const tagLines = [...tagEntries.keys()].sort((a, b) => a.localeCompare(b)).map((tag) => `- [${tag}](tags/${tag}.md)`);
const updatedReadme = readme.replace(
  /## 标签\s*\n[\s\S]*?(?=\n## 项目文档)/,
  `## 标签\n\n${tagLines.join('\n')}\n`,
);
if (updatedReadme !== readme) writeAtomic(readmePath, updatedReadme);

console.log(`rebuilt ${directories(categoriesRoot).length} category indexes and ${tagEntries.size} tag indexes`);
