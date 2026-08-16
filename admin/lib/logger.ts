import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';

const LOG_FILE = path.join(PROJECT_ROOT, 'admin', 'logs.jsonl');
const AGGREGATE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface LogEntry {
  timestamp: string;
  action: string;
  status: 'success' | 'fail' | 'running';
  category?: string;
  filename?: string;
  question?: string;
  error?: string;
  detail?: string;
  count?: number; // aggregated count of merged entries
  taskId?: string; // 生成任务 id（create_question 专用，用于对账时原位更新）
}

function format(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tsMs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/** 需要聚合的 update 类 action */
const AGGREGATE_ACTIONS = new Set(['update_question', 'annotation_update', 'project_doc_update', 'external_update']);

/** 串行化所有 logs.jsonl 的读-改-写，避免聚合/对账并发时互相覆盖 */
let writeChain: Promise<unknown> = Promise.resolve();
function withLogLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

export async function appendLog(entry: Omit<LogEntry, 'timestamp'>) {
  return withLogLock(async () => {
    const ts = format();
    const line = JSON.stringify({ timestamp: ts, ...entry });

  // 聚合逻辑：同一文件 4h 内的 update 操作用最新记录替换
  if (AGGREGATE_ACTIONS.has(entry.action) && entry.category && entry.filename) {
    try {
      await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
      const raw = await fs.readFile(LOG_FILE, 'utf-8').catch(() => '');
      const lines = raw.trim().split('\n').filter(Boolean);

      // 从末尾往前找匹配项
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const prev = JSON.parse(lines[i]) as LogEntry;
          if (
            prev.action === entry.action &&
            prev.category === entry.category &&
            prev.filename === entry.filename &&
            tsMs(ts) - tsMs(prev.timestamp) < AGGREGATE_WINDOW_MS
          ) {
            // 合并：更新时间和计数
            const merged = {
              ...prev,
              timestamp: ts,
              detail: entry.detail || prev.detail,
              count: (prev.count || 1) + 1,
            };
            lines[i] = JSON.stringify(merged);
            await fs.writeFile(LOG_FILE, lines.join('\n') + '\n', 'utf-8');
            return;
          }
        } catch {}
      }
    } catch {}
  }

  // 不聚合：直接追加
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {
    console.error('Failed to write log:', e);
  }
  });
}

export async function readLogs(limit = 50, offset = 0): Promise<LogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l) as LogEntry; } catch { return null; }
    }).filter(Boolean) as LogEntry[];
    // Return newest first
    entries.reverse();
    return entries.slice(offset, offset + limit);
  } catch {
    return [];
  }
}

// Convenience functions
export async function logCreateStart(category: string, question: string, taskId?: string) {
  await appendLog({
    action: 'create_question',
    status: 'running',
    category: category || '(auto)',
    question: question.slice(0, 200),
    taskId,
  });
}

/**
 * 对账收口：按 taskId 把 running 的 create_question 行原位更新为终态。
 * 幂等：已是终态则 no-op；找不到 running 行则追加一条终态行（覆盖任务文件已建但日志未写的窗口）。
 */
export async function finalizeLogEntry(
  taskId: string,
  update: { status: 'success' | 'fail'; filename?: string; category?: string; error?: string; question?: string }
): Promise<void> {
  return withLogLock(async () => {
    const raw = await fs.readFile(LOG_FILE, 'utf-8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const prev = JSON.parse(lines[i]) as LogEntry;
        if (prev.action !== 'create_question' || prev.taskId !== taskId) continue;
        if (prev.status !== 'running') return; // 已终态，幂等跳过
        const finalized = {
          ...prev,
          status: update.status,
          filename: update.filename ?? prev.filename,
          category: update.category ?? prev.category,
          error: update.error ?? prev.error,
        };
        lines[i] = JSON.stringify(finalized);
        await fs.writeFile(LOG_FILE, lines.join('\n') + '\n', 'utf-8');
        return;
      } catch {}
    }

    // 没有匹配的 running 行 → 追加终态行
    const line = JSON.stringify({
      timestamp: format(),
      action: 'create_question',
      status: update.status,
      category: update.category ?? '(auto)',
      filename: update.filename,
      question: update.question?.slice(0, 200),
      error: update.error,
      taskId,
    });
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, line + '\n', 'utf-8');
  });
}

/**
 * 清理无主的卡死 running 行（旧代码遗留、任务文件丢失）。
 * 有 taskId 且任务文件还在的行交给 reconcileTask 处理，这里跳过。
 * 返回被翻成 fail 的行数。
 */
export async function failStaleRunningEntries(opts: {
  maxAgeMs: number;
  hasTaskFile: (taskId: string) => Promise<boolean>;
}): Promise<number> {
  return withLogLock(async () => {
    const raw = await fs.readFile(LOG_FILE, 'utf-8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);
    let changed = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const prev = JSON.parse(lines[i]) as LogEntry;
        if (prev.action !== 'create_question' || prev.status !== 'running') continue;
        if (prev.taskId && (await opts.hasTaskFile(prev.taskId))) continue; // 交给 reconcileTask

        // 后面有同题目的终态行（旧代码重试/成功追加）→ 立即采纳其结局，无需等超时
        const later = lines.slice(i + 1).find((l) => {
          try {
            const e = JSON.parse(l) as LogEntry;
            return e.action === 'create_question' && e.status !== 'running' && e.question === prev.question;
          } catch {
            return false;
          }
        });
        let finalized: LogEntry;
        if (later) {
          const le = JSON.parse(later) as LogEntry;
          finalized = {
            ...prev,
            status: le.status,
            filename: le.filename ?? prev.filename,
            category: le.category ?? prev.category,
            error: le.error ?? prev.error,
          };
        } else {
          if (Date.now() - tsMs(prev.timestamp) < opts.maxAgeMs) continue; // 可能是在途的旧代码任务
          finalized = {
            ...prev,
            status: 'fail' as const,
            error: prev.taskId ? '任务记录丢失（tasks 文件不存在）' : '进程中断（服务重启，任务状态丢失）',
          };
        }
        lines[i] = JSON.stringify(finalized);
        changed++;
      } catch {}
    }

    if (changed > 0) {
      await fs.writeFile(LOG_FILE, lines.join('\n') + '\n', 'utf-8');
    }
    return changed;
  });
}

export async function logCreate(success: boolean, category: string, filename: string, question: string, error?: string) {
  await appendLog({
    action: 'create_question',
    status: success ? 'success' : 'fail',
    category,
    filename,
    question: question.slice(0, 200),
    error,
  });
}

export async function logUpdate(category: string, filename: string) {
  await appendLog({
    action: 'update_question',
    status: 'success',
    category,
    filename,
  });
}

export async function logDelete(category: string, filename: string) {
  await appendLog({
    action: 'delete_question',
    status: 'success',
    category,
    filename,
  });
}

export async function logAnswer(category: string, filename: string, detail?: string) {
  await appendLog({
    action: 'answer_random',
    status: 'success',
    category,
    filename,
    detail: detail?.slice(0, 200),
  });
}

export async function logAnnotation(category: string, filename: string, action: string, detail?: string) {
  await appendLog({
    action: `annotation_${action}`,
    status: 'success',
    category,
    filename,
    detail: detail?.slice(0, 200),
  });
}

export async function logCreateProjectSubdir(subdir: string) {
  await appendLog({
    action: 'create_project_subdir',
    status: 'success',
    category: 'project',
    detail: subdir,
  });
}

export async function logCreateProjectDoc(subdir: string, filename: string, title: string) {
  await appendLog({
    action: 'create_project_doc',
    status: 'success',
    category: subdir,
    filename,
    detail: title,
  });
}

export async function logUpdateProjectDoc(subdir: string, filename: string) {
  await appendLog({
    action: 'project_doc_update',
    status: 'success',
    category: subdir,
    filename,
  });
}
