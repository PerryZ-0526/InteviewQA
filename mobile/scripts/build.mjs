import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildContentManifest } from './content-manifest.mjs';

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

// Bundle browser dependencies locally so the native app works without network access.
const vendorDir = path.join(dist, 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'lib', 'marked.esm.js'), path.join(vendorDir, 'marked.esm.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'), path.join(vendorDir, 'purify.es.mjs'));

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

const manifest = buildContentManifest(projectRoot);
fs.writeFileSync(path.join(dist, 'content-manifest.json'), JSON.stringify(manifest), 'utf8');

console.log('build done → dist/');
