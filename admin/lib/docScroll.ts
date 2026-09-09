// 文档阅读位置持久化：记录每个文档上次阅读到的滚动位置（localStorage，按文档身份标识）。
// 文档身份与最近浏览（recent.ts）口径一致：kind + category + filename，
// category/random/review 三种标签统一归入 category，同一文档换标签打开也能命中同一条记录。
// page.tsx 滚动时调用 setDocScroll 写入；文档重新打开时读取并弹顶部提示条询问是否恢复。

export type DocScrollKind = 'category' | 'project' | 'external';

const STORAGE_KEY = 'interviewqa:doc-scroll';

/** 组装文档身份键：用 \u0000 分隔避免 category/filename 含分隔符时产生歧义 */
export function docScrollKey(kind: DocScrollKind, category: string, filename: string): string {
  return `${kind}\u0000${category}\u0000${filename}`;
}

/** 单条阅读位置记录：pos = 距文档顶部的像素位置；pct = 写入时按文档总高折算的百分比位置（0-100，用于询问条展示） */
export interface DocScrollEntry {
  pos: number;
  pct: number | null;
}

/** 读取全部文档位置记录；localStorage 不可用或数据损坏时返回空对象 */
function getDocScrolls(): Record<string, DocScrollEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    // 兼容两种取值：旧版的纯数字（只有像素位置，百分比未知）和新版的 { pos, pct } 对象，脏数据直接丢弃
    const entries: [string, DocScrollEntry][] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        entries.push([k, { pos: v, pct: null }]);
      } else if (v && typeof v === 'object' && typeof (v as any).pos === 'number' && Number.isFinite((v as any).pos)) {
        const pct = (v as any).pct;
        entries.push([k, { pos: (v as any).pos, pct: typeof pct === 'number' && Number.isFinite(pct) ? pct : null }]);
      }
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

/** 读取单个文档的上次阅读位置；无记录返回 null */
export function getDocScroll(key: string): DocScrollEntry | null {
  return getDocScrolls()[key] ?? null;
}

/** 写入单个文档的阅读位置（localStorage 不可用时静默降级为不记录）；pct 为该位置占文档总高的百分比，可为 null */
export function setDocScroll(key: string, pos: number, pct: number | null): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(pos)) return;
  try {
    const next = getDocScrolls();
    next[key] = { pos: Math.max(0, Math.round(pos)), pct };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级
  }
}
