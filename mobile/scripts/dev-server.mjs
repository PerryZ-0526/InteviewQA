import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildContentManifest } from './content-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const projectRoot = path.resolve(root, '..');

const PORT = 4444;
const HOST = '127.0.0.1';
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  if (url === '/') url = '/index.html';

  if (url === '/content-manifest.json') {
    const manifest = buildContentManifest(projectRoot);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(manifest));
    return;
  }

  if (url === '/vendor/marked.esm.js') {
    tryServe(path.join(root, 'node_modules', 'marked', 'lib', 'marked.esm.js'), res);
    return;
  }
  if (url === '/vendor/purify.es.mjs') {
    tryServe(path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'), res);
    return;
  }

  // Content from project root
  if (url.startsWith('/categories/') || url.startsWith('/tags/') || url.startsWith('/project/') || url.startsWith('/groups/')) {
    const fpath = path.join(projectRoot, url);
    tryServe(fpath, res);
    return;
  }

  // App files
  const fpath = path.join(root, url);
  tryServe(fpath, res);
}).listen(PORT, HOST);

function tryServe(fpath, res) {
  try {
    const resolved = path.resolve(fpath);
    const allowedRoots = [root, projectRoot].map((item) => `${path.resolve(item)}${path.sep}`);
    if (!allowedRoots.some((allowed) => resolved.startsWith(allowed))) throw new Error('Forbidden');
    const data = fs.readFileSync(fpath);
    const ext = path.extname(fpath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

console.log(`Mobile dev server: http://${HOST}:${PORT}`);
