import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const projectRoot = path.resolve(root, '..');

const PORT = 4444;
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
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
  let url = req.url;
  if (url === '/') url = '/index.html';

  // Content from project root
  if (url.startsWith('/categories/') || url.startsWith('/tags/') || url.startsWith('/project/') || url.startsWith('/groups/')) {
    const fpath = path.join(projectRoot, url);
    tryServe(fpath, res);
    return;
  }

  // App files
  const fpath = path.join(root, url);
  tryServe(fpath, res);
}).listen(PORT);

function tryServe(fpath, res) {
  try {
    const data = fs.readFileSync(fpath);
    const ext = path.extname(fpath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

console.log(`Mobile dev server: http://localhost:${PORT}`);
