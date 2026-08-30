// 标签页会话持久化：浏览器式「恢复上次关闭的标签页」。
// 应用运行期间持续记录当前打开的标签工作集到 localStorage；
// 下次启动时由页面读取并弹出恢复询问条，用户确认后重建标签。
//
// 表单标签（kind='form'）承载一次性草稿且无草稿持久化机制，
// 重启后恢复出来的只会是空表单，容易造成「草稿还在」的错觉，故不纳入会话。

export interface StoredTab {
  id: string;
  kind: 'category' | 'random' | 'review' | 'project' | 'external' | 'form';
  category?: string;
  filename?: string;
  subdir?: string;
  extId?: string;
  label: string;
}

export interface TabSession {
  version: 1;
  savedAt: number;
  activeTabId: string | null;
  tabs: StoredTab[];
}

const STORAGE_KEY = 'qa-open-tabs';

/** 可恢复的标签类型（form 草稿不可恢复，见文件头注释） */
const RESTORABLE_KINDS: ReadonlyArray<StoredTab['kind']> = [
  'category',
  'random',
  'review',
  'project',
  'external',
];

/** 字段完整性校验：缺失定位字段的脏数据不放行，避免恢复出打不开的空标签 */
function isRestorable(tab: StoredTab): boolean {
  if (!tab || typeof tab.id !== 'string' || !RESTORABLE_KINDS.includes(tab.kind)) return false;
  if (tab.kind === 'category' || tab.kind === 'random' || tab.kind === 'review') {
    return !!tab.category && !!tab.filename;
  }
  if (tab.kind === 'project') return !!tab.subdir && !!tab.filename;
  if (tab.kind === 'external') return !!tab.extId;
  return false;
}

/** 读取上次会话；不存在、格式非法或无可恢复标签时返回 null */
export function loadTabSession(): TabSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TabSession;
    if (!data || data.version !== 1 || !Array.isArray(data.tabs)) return null;
    const tabs = data.tabs.filter(isRestorable);
    if (tabs.length === 0) return null;
    const activeTabId = tabs.some((t) => t.id === data.activeTabId) ? data.activeTabId : tabs[0].id;
    return { version: 1, savedAt: data.savedAt ?? 0, activeTabId, tabs };
  } catch {
    return null;
  }
}

/**
 * 持久化当前打开的标签（自动过滤不可恢复的标签）。
 * 过滤后为空时直接清除记录——关闭全部标签即代表没有要恢复的内容。
 */
export function saveTabSession(tabs: StoredTab[], activeTabId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const restorable = tabs.filter(isRestorable);
    if (restorable.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const session: TabSession = {
      version: 1,
      savedAt: Date.now(),
      activeTabId: restorable.some((t) => t.id === activeTabId) ? activeTabId : restorable[0].id,
      tabs: restorable,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅本次会话生效
  }
}

/** 清除会话记录（用户选择不恢复 / 全部标签失效时调用） */
export function clearTabSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同 saveTabSession
  }
}
