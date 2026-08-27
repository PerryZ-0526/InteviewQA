import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT } from './fileUtils';

const FSRS_PATH = path.join(PROJECT_ROOT, 'admin', 'fsrs.json');

/** 一次评分的历史记录（每卡最多保留 20 条，供将来热力图/连续打卡统计） */
export interface FsrsReviewEntry {
  rating: number;          // ts-fsrs Rating 枚举值：1=Again 2=Hard 3=Good 4=Easy
  timestamp: string;       // ISO
  scheduled_days: number;
  elapsed_days: number;
}

/** ts-fsrs Card 的序列化形态（Date 字段转 ISO 字符串），外加评分历史 */
export interface FsrsCardData {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;           // ts-fsrs State 枚举值：0=New 1=Learning 2=Review 3=Relearning
  last_review: string | null;
  /** v5 新增字段等原样保留（序列化用展开运算符，向前兼容） */
  [extra: string]: unknown;
  history?: FsrsReviewEntry[];
}

export interface FsrsStore {
  version: number;
  cards: Record<string, FsrsCardData>;
}

const EMPTY_STORE: FsrsStore = { version: 1, cards: {} };

export async function loadFsrsStore(): Promise<FsrsStore> {
  try {
    const raw = await fs.readFile(FSRS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cards === 'object' && parsed.cards !== null) {
      return { version: parsed.version ?? 1, cards: parsed.cards };
    }
    return EMPTY_STORE;
  } catch {
    return EMPTY_STORE;
  }
}

export async function saveFsrsStore(store: FsrsStore): Promise<void> {
  await fs.mkdir(path.dirname(FSRS_PATH), { recursive: true });
  await fs.writeFile(FSRS_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * 题目移动/删除/重排后改写卡片 key。
 * to 为 null 表示删除该卡。返回实际改动的条数。
 */
export async function remapFsrsKeys(
  mapping: { from: string; to: string | null }[]
): Promise<number> {
  if (mapping.length === 0) return 0;
  const store = await loadFsrsStore();
  let changed = 0;
  for (const { from, to } of mapping) {
    if (!(from in store.cards)) continue;
    if (to === null) {
      delete store.cards[from];
    } else if (from !== to) {
      store.cards[to] = store.cards[from];
      delete store.cards[from];
    }
    changed++;
  }
  if (changed > 0) await saveFsrsStore(store);
  return changed;
}
