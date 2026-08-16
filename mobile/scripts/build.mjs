import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const projectRoot = path.resolve(root, '..');
const dist = path.resolve(root, 'dist');

// Clean dist
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Copy src files
fs.cpSync(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));

// Copy content directories from project root
const dirs = ['categories', 'tags', 'project', 'groups'];
for (const dir of dirs) {
  const src = path.join(projectRoot, dir);
  const dest = path.join(dist, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`copied ${dir}/`);
  }
}

console.log('build done → dist/');
