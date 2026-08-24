import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './paths';

const BACKUP_ROOT = path.join(PROJECT_ROOT, 'admin', 'backups');
const MAX_VERSIONS = 5;
const THROTTLE_MS = 5 * 60 * 1000;
const TS_RE = /^(\d{8})-(\d{6})\.md$/;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function tsToMs(ts: string): number {
  return new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`,
  ).getTime();
}

/**
 * 保存前备份旧内容到 admin/backups/<backupRelDir>/<filename>--<时间戳>.md。
 * - 每份文档最多保留 5 个版本，超出删除最旧的
 * - 5 分钟内已有备份则跳过（自动保存节流）
 * - 新文件（无旧内容）或内容无变化时不备份
 * 备份失败静默忽略，不影响主保存流程。
 * docPath 为文档实际路径（可为仓库外文件），backupRelDir 为备份目录的相对路径。
 */
export async function backupBeforeWriteAt(
  docPath: string,
  backupRelDir: string,
  filename: string,
  newContent: string,
): Promise<void> {
  try {
    let oldContent: string | null = null;
    try {
      oldContent = await fs.readFile(docPath, 'utf-8');
    } catch {
      oldContent = null;
    }
    if (oldContent === null || oldContent === newContent) return;

    const backupDir = path.join(BACKUP_ROOT, backupRelDir);
    await fs.mkdir(backupDir, { recursive: true });

    const prefix = `${filename}--`;
    const listBackups = async () =>
      (await fs.readdir(backupDir)).filter((f) => f.startsWith(prefix) && TS_RE.test(f.slice(prefix.length)));

    // 节流：最近 5 分钟内已有备份则跳过
    const existing = await listBackups();
    if (existing.length > 0) {
      const newest = existing
        .map((f) => f.slice(prefix.length, -3))
        .sort()
        .pop()!;
      if (Date.now() - tsToMs(newest) < THROTTLE_MS) return;
    }

    await fs.writeFile(path.join(backupDir, `${prefix}${timestamp()}.md`), oldContent, 'utf-8');

    // 清理：只保留最近 MAX_VERSIONS 个版本
    const all = (await listBackups()).sort();
    const excess = all.slice(0, Math.max(0, all.length - MAX_VERSIONS));
    for (const f of excess) {
      await fs.unlink(path.join(backupDir, f)).catch(() => {});
    }
  } catch {}
}

/** 仓库内文档的便捷入口：docPath = PROJECT_ROOT/<relDir>/<filename> */
export async function backupBeforeWrite(relDir: string, filename: string, newContent: string): Promise<void> {
  await backupBeforeWriteAt(path.join(PROJECT_ROOT, relDir, filename), relDir, filename, newContent);
}
