import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './paths';

// 待入库题单：收集到的面试题暂存文件（应用数据，与 fsrs.json / external-docs.json 同级）
const INBOX_FILE = path.join(PROJECT_ROOT, 'admin', 'inbox.md');

export interface InboxQuestion {
  text: string;
  checked: boolean;
}

export interface InboxBatch {
  /** 批次时间，格式 YYYY-MM-DD HH:mm:ss（北京时间） */
  time: string;
  questions: InboxQuestion[];
}

/** 当前北京时间，格式 YYYY-MM-DD HH:mm:ss（不依赖服务器本地时区） */
function beijingNow(): string {
  const d = new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 读取并解析待入库题单（文件不存在时返回空列表）。
 * md 格式：`## <时间>` 开启一个批次，`- [ ] / - [x]` 为题目及其勾选状态；
 * 批次按时间正序存储（旧批次在前），前端展示时自行倒序。
 */
export async function readInbox(): Promise<InboxBatch[]> {
  let raw: string;
  try {
    raw = await fs.readFile(INBOX_FILE, 'utf-8');
  } catch {
    return [];
  }

  const batches: InboxBatch[] = [];
  for (const line of raw.split('\n')) {
    // `## <时间>` 开启一个批次（`^##\s` 不会误匹配 # 或 ###）
    const batchMatch = line.match(/^##\s+(.+?)\s*$/);
    if (batchMatch) {
      batches.push({ time: batchMatch[1], questions: [] });
      continue;
    }
    // `- [ ]` / `- [x]` 为一道题目
    const qMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)$/);
    if (qMatch && batches.length > 0) {
      batches[batches.length - 1].questions.push({
        checked: qMatch[1].toLowerCase() === 'x',
        text: qMatch[2].trim(),
      });
    }
  }
  // 丢弃空题目行与空批次
  return batches
    .map((b) => ({ ...b, questions: b.questions.filter((q) => q.text) }))
    .filter((b) => b.questions.length > 0);
}

/** 把批次结构序列化为 md 文本（时间正序书写） */
export function serializeInbox(batches: InboxBatch[]): string {
  const lines: string[] = ['# 待入库题单'];
  for (const batch of batches) {
    lines.push('', `## ${batch.time}`);
    for (const q of batch.questions) {
      lines.push(`- [${q.checked ? 'x' : ' '}] ${q.text}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** 全量覆写题单文件 */
export async function writeInbox(batches: InboxBatch[]): Promise<void> {
  await fs.mkdir(path.dirname(INBOX_FILE), { recursive: true });
  await fs.writeFile(INBOX_FILE, serializeInbox(batches), 'utf-8');
}

/** 追加一个新批次（服务器当前北京时间），返回更新后的全部批次 */
export async function appendInboxBatch(questions: string[]): Promise<InboxBatch[]> {
  const batches = await readInbox();
  batches.push({
    time: beijingNow(),
    questions: questions.map((text) => ({ text, checked: false })),
  });
  await writeInbox(batches);
  return batches;
}
