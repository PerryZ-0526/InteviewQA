import path from 'path';

// 项目根目录（admin/.. 即 InteviewQA/）。
// 独立成模块以切断 fileUtils ↔ backup/logger 的循环依赖：
// backup/logger 需要 PROJECT_ROOT，fileUtils 又需要 backupBeforeWrite。
export const PROJECT_ROOT = path.resolve(process.cwd(), '..');
