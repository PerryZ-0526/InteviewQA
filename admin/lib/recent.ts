// 最近浏览记录：仅客户端使用，localStorage 持久化，最多保留 10 条
// 记录范围覆盖所有文档类型：分类题目、project 文档、外部文档
// page.tsx 打开任意类型文档时调用 pushRecent 写入；Sidebar 顶部「最近浏览」下拉打开时调用 getRecent 读取

// 文档类型：分类题目 / project 文档 / 外部文档
export type RecentKind = 'category' | 'project' | 'external';

export interface RecentEntry {
  kind: RecentKind; // 文档类型
  category: string; // 分类 slug 或 project 子目录 slug（external 类型为空字符串）
  filename: string; // 文件名（external 类型为外部文档 id）
  title: string; // 文档标题（展示用）
  ts: number; // 打开时间（毫秒时间戳）
}

const STORAGE_KEY = 'interviewqa:recent';
const MAX_ENTRIES = 10;

/** 读取最近浏览列表（最近的在前），localStorage 不可用时返回空数组；旧记录无 kind 字段时按分类题目处理 */
export function getRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 兼容历史数据：早期记录只存分类题目，没有 kind 字段
    return arr.slice(0, MAX_ENTRIES).map((e: Partial<RecentEntry>) => ({
      kind: e.kind ?? 'category',
      category: e.category ?? '',
      filename: e.filename ?? '',
      title: e.title ?? '',
      ts: e.ts ?? 0,
    }));
  } catch {
    return [];
  }
}

/** 追加一条最近浏览记录：同一文档去重（kind+category+filename 相同视为同一文档，移除旧记录后插到最前），超出上限截断 */
export function pushRecent(entry: Omit<RecentEntry, 'ts'>): void {
  if (typeof window === 'undefined') return;
  try {
    const rest = getRecent().filter(
      (e) => !(e.kind === entry.kind && e.category === entry.category && e.filename === entry.filename)
    );
    const next = [{ ...entry, ts: Date.now() }, ...rest].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅本次会话不记录
  }
}
