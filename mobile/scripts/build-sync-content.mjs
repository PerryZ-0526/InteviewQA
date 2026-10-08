import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentManifest } from './content-manifest.mjs';
import { CONTENT_ROOTS, writeSyncManifest } from './sync-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(mobileRoot, '..');
const outputRoot = path.join(mobileRoot, 'sync-dist');
const contentRoot = path.join(outputRoot, 'mobile-content');

function currentCommit() {
  if (process.env.CONTENT_VERSION) return process.env.CONTENT_VERSION;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  return dirty ? `${commit}-dev-${Date.now()}` : commit;
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(contentRoot, { recursive: true });

for (const directory of CONTENT_ROOTS) {
  const source = path.join(projectRoot, directory);
  if (fs.existsSync(source)) {
    fs.cpSync(source, path.join(contentRoot, directory), { recursive: true });
  }
}

const contentManifest = buildContentManifest(projectRoot);
fs.writeFileSync(
  path.join(contentRoot, 'content-manifest.json'),
  JSON.stringify(contentManifest),
  'utf8',
);

const manifest = writeSyncManifest(contentRoot, 'sync-manifest.json', {
  contentVersion: currentCommit(),
});

console.log(`sync content ready: ${manifest.files.length} files → ${contentRoot}`);
