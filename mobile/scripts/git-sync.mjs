import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

try {
  console.log('syncing from git...');
  const out = execSync('git pull', { cwd: root, encoding: 'utf-8' });
  console.log(out);
} catch (e) {
  console.error('git pull failed:', e.message);
  process.exit(1);
}
