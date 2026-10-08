import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SYNC_SCHEMA_VERSION = 1;
export const CONTENT_ROOTS = ['categories', 'groups', 'project', 'tags'];

function contentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return {
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }[extension] || 'application/octet-stream';
}

function listFiles(root, relativeDir) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name);
    return entry.isDirectory()
      ? listFiles(root, relativePath)
      : [relativePath];
  });
}

function fileDescriptor(root, relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    contentType: contentType(relativePath),
  };
}

export function createSyncManifest(root, {
  contentVersion,
  generatedAt = new Date().toISOString(),
  minAppVersion = '1.0.0',
} = {}) {
  const files = [
    ...(fs.existsSync(path.join(root, 'content-manifest.json')) ? ['content-manifest.json'] : []),
    ...CONTENT_ROOTS.flatMap((directory) => listFiles(root, directory)),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((relativePath) => fileDescriptor(root, relativePath));

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    contentVersion: contentVersion || 'development',
    generatedAt,
    minAppVersion,
    files,
  };
}

export function writeSyncManifest(root, filename, options) {
  const manifest = createSyncManifest(root, options);
  fs.writeFileSync(path.join(root, filename), JSON.stringify(manifest), 'utf8');
  return manifest;
}
