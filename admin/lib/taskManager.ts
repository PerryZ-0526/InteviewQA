import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';
import { TASK_TIMEOUT_MS } from './claudeCode';
import { finalizeLogEntry, failStaleRunningEntries } from './logger';

export const TASKS_DIR = path.join(PROJECT_ROOT, 'admin', 'tasks');
const CATEGORIES_DIR = path.join(PROJECT_ROOT, 'categories');
const NULL_PID_GRACE_MS = 60 * 1000;
const MAX_OUTPUT_READ = 1024 * 1024;
const SWEEP_THROTTLE_MS = 2000;
const STALE_LOG_ENTRY_MS = 60 * 60 * 1000;

export interface GenTask {
  id: string;
  question: string;
  category: string; // 请求时指定的分类，'' = 自动判断
  tags: string[];
  extraRequirements?: string;
  includeAnswer: boolean;
  includeAnalysis: boolean;
  pid: number | null; // null = spawn 尚未落盘
  startedAt: number; // epoch ms
  outputFile: string; // 绝对路径，claude stdout/stderr 直写
  snapshot: Record<string, string[]>; // 生成前的文件快照，落盘以跨重启
  status: 'running' | 'success' | 'fail';
  filename?: string | null;
  resolvedCategory?: string | null; // 文件实际落地的分类
  error?: string | null;
  finishedAt?: number | null;
}

function taskPath(id: string): string {
  return path.join(TASKS_DIR, id + '.json');
}

export async function createTaskFile(task: GenTask): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  await fs.writeFile(taskPath(task.id), JSON.stringify(task, null, 2), 'utf-8');
}

export async function getTask(id: string): Promise<GenTask | null> {
  try {
    const raw = await fs.readFile(taskPath(id), 'utf-8');
    return JSON.parse(raw) as GenTask;
  } catch {
    return null;
  }
}

export async function writeTask(task: GenTask): Promise<void> {
  await fs.writeFile(taskPath(task.id), JSON.stringify(task, null, 2), 'utf-8');
}

export async function listRunningTasks(): Promise<GenTask[]> {
  try {
    const files = await fs.readdir(TASKS_DIR);
    const tasks: GenTask[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const t = await getTask(f.slice(0, -5));
      if (t && t.status === 'running') tasks.push(t);
    }
    return tasks;
  } catch {
    return [];
  }
}

/** pid 存活探测：signal 0 只查存在性；EPERM 说明进程存在但无权限，视为存活 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

/** per-task 串行锁，防止 logs 轮询与 task 轮询并发对账同一任务 */
const taskLocks = new Map<string, Promise<unknown>>();
function withTaskLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  taskLocks.set(id, run.catch(() => {}));
  return run;
}

async function finalizeTask(
  task: GenTask,
  status: 'success' | 'fail',
  opts: { filename?: string; resolvedCategory?: string; error?: string }
): Promise<void> {
  task.status = status;
  task.finishedAt = Date.now();
  if (opts.filename) task.filename = opts.filename;
  if (opts.resolvedCategory) task.resolvedCategory = opts.resolvedCategory;
  if (opts.error) task.error = opts.error;
  await writeTask(task);
  await finalizeLogEntry(task.id, {
    status,
    filename: task.filename ?? undefined,
    category: (task.resolvedCategory ?? task.category) || undefined,
    error: task.error ?? undefined,
    question: task.question,
  });
}

/** 读取任务输出文件；超过 1MB 只读尾部（FILE_CREATED 标记按契约在末尾输出） */
async function readOutputFile(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_OUTPUT_READ) {
      const fd = await fs.open(file, 'r');
      try {
        const buf = Buffer.alloc(MAX_OUTPUT_READ);
        await fd.read(buf, 0, MAX_OUTPUT_READ, stat.size - MAX_OUTPUT_READ);
        return buf.toString('utf-8');
      } finally {
        await fd.close();
      }
    }
    return await fs.readFile(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * 对账单个任务：pid 存活判定 + 30 分钟超时上限 + 输出文件 FILE_CREATED 解析 + 快照兜底。
 * 幂等：非 running 状态直接返回。
 */
export async function reconcileTask(id: string): Promise<GenTask | null> {
  return withTaskLock(id, async () => {
    const task = await getTask(id);
    if (!task) return null;
    if (task.status !== 'running') return task;

    if (task.pid === null) {
      if (Date.now() - task.startedAt < NULL_PID_GRACE_MS) return task; // spawn 中
      await finalizeTask(task, 'fail', { error: '进程启动失败或状态丢失' });
      return task;
    }

    if (isPidAlive(task.pid)) {
      if (Date.now() - task.startedAt > TASK_TIMEOUT_MS) {
        try { process.kill(task.pid); } catch {}
        await finalizeTask(task, 'fail', { error: '生成超时（30分钟），请简化题目描述或检查 Claude Code 是否正常运行' });
      }
      return task;
    }

    // pid 已死：检查输出文件定成败
    const out = await readOutputFile(task.outputFile);
    const otherKeys = await otherTaskQuestionKeys(task.id);
    const marker = out.match(/FILE_CREATED:\s*(.+\.md)/);
    if (marker) {
      const parts = marker[1].trim().replace(/\\/g, '/').split('/');
      if (parts.length === 3 && parts[0] === 'categories') {
        // 文件可能已被并发任务同名覆盖：内容属于其他任务则不认领，走快照兜底
        if (await fileClaimable(parts[1], parts[2], task.question, otherKeys)) {
          await finalizeTask(task, 'success', { filename: parts[2], resolvedCategory: parts[1] });
          return task;
        }
      }
    }

    // 快照兜底：按题目文本校验归属，避免认领其他并发任务新建的文件
    const found = await findNewFileFromSnapshot(task.snapshot, task.category || '', task.question, otherKeys);
    if (found) {
      await finalizeTask(task, 'success', { filename: found.filename, resolvedCategory: found.category });
      return task;
    }

    await finalizeTask(task, 'fail', {
      error: `进程已退出但未输出 FILE_CREATED 标记 | 输出尾部: ${out.slice(-500)}`,
    });
    return task;
  });
}

let lastSweepAt = 0;

/** 对账全部 running 任务 + 清理无主卡死日志行。有 2s 全局节流。 */
export async function reconcileAllRunning(): Promise<void> {
  if (Date.now() - lastSweepAt < SWEEP_THROTTLE_MS) return;
  lastSweepAt = Date.now();

  try {
    const files = await fs.readdir(TASKS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const t = await getTask(id);
      if (t && t.status === 'running') await reconcileTask(id);
    }
  } catch {}

  await failStaleRunningEntries({
    maxAgeMs: STALE_LOG_ENTRY_MS,
    hasTaskFile: async (taskId) => {
      try {
        await fs.access(path.join(TASKS_DIR, taskId + '.json'));
        return true;
      } catch {
        return false;
      }
    },
  });
}

/** 用户放弃：杀进程（若活着）+ 终态失败。幂等。 */
export async function abandonTask(id: string): Promise<GenTask | null> {
  return withTaskLock(id, async () => {
    const task = await getTask(id);
    if (!task || task.status !== 'running') return task;
    if (task.pid) {
      try { process.kill(task.pid); } catch {}
    }
    await finalizeTask(task, 'fail', { error: '用户主动放弃' });
    return task;
  });
}

/** spawn 失败等即时错误收口（供 generate 路由的 error 回调使用） */
export async function failTaskNow(id: string, error: string): Promise<void> {
  await withTaskLock(id, async () => {
    const task = await getTask(id);
    if (!task || task.status !== 'running') return;
    await finalizeTask(task, 'fail', { error });
  });
}

/** 去重/归属校验键：压缩全部空白，避免换行和空格差异导致漏判 */
export function normalizeQuestionKey(text: string): string {
  return text.replace(/\s+/g, '');
}

/** 其他任务（含已终态）的题目文本键，用于检测文件归属冲突 */
async function otherTaskQuestionKeys(exceptId: string): Promise<string[]> {
  try {
    const files = await fs.readdir(TASKS_DIR);
    const keys: string[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const t = await getTask(f.slice(0, -5));
      if (t && t.id !== exceptId && t.question) keys.push(normalizeQuestionKey(t.question));
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * 文件归属判定：包含本题文本 → 归本题；包含其他任务的题目文本 → 归他题（冲突）；
 * 两者皆无（题目可能被改写）→ 视为可认领，保持单任务时的旧行为。
 */
function claimableBy(ownQuestion: string, otherKeys: string[], content: string): boolean {
  const norm = normalizeQuestionKey(content);
  const own = normalizeQuestionKey(ownQuestion);
  if (own && norm.includes(own)) return true;
  if (otherKeys.some((k) => k && norm.includes(k))) return false;
  return true;
}

async function fileClaimable(
  cat: string,
  file: string,
  ownQuestion: string,
  otherKeys: string[]
): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(CATEGORIES_DIR, cat, file), 'utf-8');
    return claimableBy(ownQuestion, otherKeys, content);
  } catch {
    return false;
  }
}

/** 记录分类目录的当前文件状态 */
export async function takeSnapshot(specificCategory: string): Promise<Record<string, string[]>> {
  const snapshot: Record<string, string[]> = {};

  if (specificCategory) {
    try {
      const files = await fs.readdir(path.join(CATEGORIES_DIR, specificCategory));
      snapshot[specificCategory] = files.filter((f) => f.match(/^\d{3}-.+\.md$/));
    } catch {}
  } else {
    const entries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const files = await fs.readdir(path.join(CATEGORIES_DIR, entry.name));
      snapshot[entry.name] = files.filter((f) => f.match(/^\d{3}-.+\.md$/));
    }
  }

  return snapshot;
}

/** 对比快照找到新文件；传入 question 时校验文件正文归属（并发任务互不认领） */
export async function findNewFileFromSnapshot(
  snapshot: Record<string, string[]>,
  preferredCategory: string,
  question?: string,
  otherKeys?: string[]
): Promise<{ category: string; filename: string } | null> {
  const tryClaim = async (cat: string): Promise<{ category: string; filename: string } | null> => {
    try {
      const mdFiles = (await fs.readdir(path.join(CATEGORIES_DIR, cat))).filter((f) =>
        f.match(/^\d{3}-.+\.md$/)
      );
      const oldFiles = snapshot[cat] || [];
      const added = mdFiles.filter((f) => !oldFiles.includes(f));
      for (const f of added) {
        if (!question) return { category: cat, filename: f };
        if (await fileClaimable(cat, f, question, otherKeys || [])) {
          return { category: cat, filename: f };
        }
      }
    } catch {}
    return null;
  };

  const categories = [preferredCategory, ...Object.keys(snapshot)].filter(
    (c, i, arr) => c && arr.indexOf(c) === i
  );

  for (const cat of categories) {
    const found = await tryClaim(cat);
    if (found) return found;
  }

  const allEntries = await fs.readdir(CATEGORIES_DIR, { withFileTypes: true });
  for (const entry of allEntries) {
    if (!entry.isDirectory() || snapshot[entry.name]) continue;
    const found = await tryClaim(entry.name);
    if (found) return found;
  }

  return null;
}
