// 最近浏览记录：仅客户端使用，localStorage 持久化，最多保留 10 条
// page.tsx 打开题目时调用 pushRecent 写入；Sidebar 顶部「最近浏览」下拉打开时调用 getRecent 读取

export interface RecentEntry {
  category: string; // 分类 slug
  filename: string; // 题目文件名
  title: string; // 题目标题（展示用）
  ts: number; // 打开时间（毫秒时间戳）
}

const STORAGE_KEY = 'interviewqa:recent';
const MAX_ENTRIES = 10;

/** 读取最近浏览列表（最近的在前），localStorage 不可用时返回空数组 */
export function getRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

/** 追加一条最近浏览记录：同一题目去重（移除旧记录后插到最前），超出上限截断 */
export function pushRecent(entry: Omit<RecentEntry, 'ts'>): void {
  if (typeof window === 'undefined') return;
  try {
    const rest = getRecent().filter(
      (e) => !(e.category === entry.category && e.filename === entry.filename)
    );
    const next = [{ ...entry, ts: Date.now() }, ...rest].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅本次会话不记录
  }
}
