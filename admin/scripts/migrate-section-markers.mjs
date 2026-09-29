import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateQuestionSections } from './section-marker-migration.mjs';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(adminRoot, '..');
const categoriesRoot = path.join(projectRoot, 'categories');
const write = process.argv.includes('--write');

const targets = [];
for (const category of await fs.readdir(categoriesRoot, { withFileTypes: true })) {
  if (!category.isDirectory()) continue;
  const dirPath = path.join(categoriesRoot, category.name);
  const filenames = (await fs.readdir(dirPath))
    .filter((filename) => /^\d{3}-.+\.md$/u.test(filename) && filename !== '00-index.md')
    .sort();
  for (const filename of filenames) {
    targets.push({
      relativePath: path.join('categories', category.name, filename),
      filePath: path.join(dirPath, filename),
    });
  }
}

// 先完整解析全部文件，任何异常都必须发生在首次写盘之前。
const conversions = [];
for (const target of targets) {
  const original = await fs.readFile(target.filePath, 'utf8');
  const result = migrateQuestionSections(original);
  if (result.changed) conversions.push({ ...target, original, migrated: result.content });
}

console.log(`${write ? 'write' : 'dry-run'}: ${conversions.length}/${targets.length} question(s) need section markers`);
for (const item of conversions.slice(0, 20)) console.log(`  ${item.relativePath}`);
if (conversions.length > 20) console.log(`  ... and ${conversions.length - 20} more`);

if (!write || conversions.length === 0) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(adminRoot, 'backups', 'section-markers', stamp);
for (const conversion of conversions) {
  const backupPath = path.join(backupRoot, conversion.relativePath);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, conversion.original, 'utf8');

  const temporaryPath = `${conversion.filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, conversion.migrated, 'utf8');
  await fs.rename(temporaryPath, conversion.filePath);
}

console.log(`backup: ${backupRoot}`);
console.log(`migrated: ${conversions.length} question(s)`);
