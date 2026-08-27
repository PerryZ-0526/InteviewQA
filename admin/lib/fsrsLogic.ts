/**
 * FSRS 调度逻辑（同构：客户端评分/预览 + 服务端均可用，不含 fs）。
 * 包装 ts-fsrs：卡片序列化、评分、间隔预告、到期判断。
 */
import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs';
import type { FsrsCardData, FsrsReviewEntry } from './fsrsStore';

const f = fsrs();

/** repeat() 结果只含四个常规档位（Rating.Manual 为手动调度保留，不参与评分） */
export type RateableRating = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
const RATINGS: RateableRating[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

const RATING_LABELS: Record<number, string> = {
  [Rating.Again]: '忘了',
  [Rating.Hard]: '困难',
  [Rating.Good]: '记得',
  [Rating.Easy]: '简单',
};

// ---- 序列化（ts-fsrs Card 是普通对象，Date 字段需手动转 ISO） ----

export function toCard(data: FsrsCardData): Card {
  const { history: _history, ...rest } = data;
  return {
    ...rest,
    due: new Date(data.due),
    last_review: data.last_review ? new Date(data.last_review) : null,
  } as Card;
}

export function fromCard(card: Card, history?: FsrsReviewEntry[]): FsrsCardData {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
    ...(history ? { history } : {}),
  };
}

export function getOrCreateCard(data: FsrsCardData | undefined, now: Date = new Date()): Card {
  return data ? toCard(data) : createEmptyCard(now);
}

// ---- 间隔预告与评分 ----

export interface PreviewResult {
  rating: RateableRating;
  label: string;
  intervalText: string;
  card: Card;
}

/** 按 due 与当前时间的差值格式化间隔（学习阶段的卡片 scheduled_days 为 0，不能用它） */
function formatInterval(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '<1分钟';
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = ms / 86400000;
  if (days < 30) return `${Math.round(days)}天`;
  if (days < 365) return `${Math.round(days / 30)}个月`;
  return `${(days / 365).toFixed(1)}年`;
}

export function previewAllRatings(card: Card, now: Date = new Date()): PreviewResult[] {
  const scheduling = f.repeat(card, now);
  return RATINGS.map((r) => {
    const next = scheduling[r].card;
    return {
      rating: r,
      label: RATING_LABELS[r],
      intervalText: formatInterval(next.due, now),
      card: next,
    };
  });
}

export function rateCard(
  card: Card,
  rating: RateableRating,
  now: Date = new Date(),
): { card: Card; entry: FsrsReviewEntry } {
  const result = f.repeat(card, now)[rating];
  const entry: FsrsReviewEntry = {
    rating,
    timestamp: now.toISOString(),
    scheduled_days: result.card.scheduled_days,
    elapsed_days: result.card.elapsed_days,
  };
  return { card: result.card, entry };
}

// ---- 到期判断 ----

/** due 在参考日期（本地时区）当天 24:00 之前即视为到期 */
export function isDue(cardData: FsrsCardData, refDate: Date = new Date()): boolean {
  const due = new Date(cardData.due);
  if (isNaN(due.getTime())) return false;
  const endOfDay = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + 1);
  return due.getTime() <= endOfDay.getTime();
}

/**
 * 到期队列：过滤幽灵 key（题目已删除），按 due 升序。
 * existingKeys 形如 `${category}/${filename}` 的集合；不传则不过滤。
 */
export function dueEntries(
  cards: Record<string, FsrsCardData>,
  existingKeys?: Set<string>,
  refDate: Date = new Date(),
): { key: string; card: FsrsCardData }[] {
  return Object.entries(cards)
    .filter(([key, card]) => (!existingKeys || existingKeys.has(key)) && isDue(card, refDate))
    .sort(([, a], [, b]) => new Date(a.due).getTime() - new Date(b.due).getTime())
    .map(([key, card]) => ({ key, card }));
}

export type { FsrsCardData, FsrsReviewEntry, Rating, State };
