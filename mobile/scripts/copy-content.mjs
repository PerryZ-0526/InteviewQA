import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const dist = path.resolve(__dirname, '../dist');

const dirs = ['categories', 'tags', 'project', 'groups'];
for (const dir of dirs) {
  const src = path.join(root, dir);
  const dest = path.join(dist, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`copied ${dir}/ → dist/${dir}/`);
  }
}
