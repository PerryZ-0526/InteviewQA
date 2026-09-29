import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateMarkdown } from './frontmatter-migration.mjs';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(adminRoot, '..');
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const scopeArg = [...args].find((arg) => arg.startsWith('--scope='));
const scope = scopeArg?.slice('--scope='.length) || 'categories';
const allowedScopes = new Set(['categories', 'project', 'groups', 'all']);

if (!allowedScopes.has(scope)) {
  throw new Error(`不支持的 scope: ${scope}`);
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function collectTargets(rootName, kind) {
  const root = path.join(projectRoot, rootName);
  const directories = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const targets = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const dirPath = path.join(root, directory.name);
    const filenames = (await fs.readdir(dirPath))
      .filter((filename) => /^\d{3}-.+\.md$/u.test(filename) && filename !== '00-index.md')
      .sort();
    for (const filename of filenames) {
      targets.push({
        kind,
        relativePath: path.join(rootName, directory.name, filename),
        filePath: path.join(dirPath, filename),
        fallbackTitle: filename.replace(/^\d{3}-/, '').replace(/\.md$/, ''),
      });
    }
  }
  return targets;
}

const requestedRoots = scope === 'all' ? ['categories', 'project', 'groups'] : [scope];
const targetGroups = await Promise.all(
  requestedRoots.map((rootName) => collectTargets(rootName, rootName === 'categories' ? 'question' : 'document')),
);
const targets = targetGroups.flat();

// 全部文件先完成解析和转换，任何一篇失败都会在写盘前终止。
const conversions = [];
for (const target of targets) {
  const [content, stat] = await Promise.all([
    fs.readFile(target.filePath, 'utf8'),
    fs.stat(target.filePath),
  ]);
  const createdDate = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
  const migrated = migrateMarkdown(content, {
    kind: target.kind,
    fallbackTitle: target.fallbackTitle,
    createdFallback: formatDateTime(createdDate),
    updatedFallback: formatDateTime(stat.mtime),
  });
  if (migrated.changed) conversions.push({ ...target, original: content, migrated: migrated.content });
}

console.log(`${write ? 'write' : 'dry-run'}: ${conversions.length}/${targets.length} document(s) need migration`);
for (const conversion of conversions.slice(0, 20)) console.log(`  ${conversion.relativePath}`);
if (conversions.length > 20) console.log(`  ... and ${conversions.length - 20} more`);

if (!write || conversions.length === 0) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(adminRoot, 'backups', 'frontmatter-v2', stamp);
for (const conversion of conversions) {
  const backupPath = path.join(backupRoot, conversion.relativePath);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, conversion.original, 'utf8');

  const temporaryPath = `${conversion.filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, conversion.migrated, 'utf8');
  await fs.rename(temporaryPath, conversion.filePath);
}

console.log(`backup: ${backupRoot}`);
console.log(`migrated: ${conversions.length} document(s)`);
