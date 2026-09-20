import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});
console.log('Git hooks enabled from .githooks/');
