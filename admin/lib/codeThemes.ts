// 代码块配色主题：统一定义 + 持久化，通过 <html> 的 data-code-theme 属性切换。
// CSS 侧在 globals.css 用 CSS 变量消费（:root 为默认主题，[data-code-theme=...] 覆盖变量），
// 新增主题只需在本表加一项 + 在 CSS 加一组变量覆盖，token 选择器不用动。
// 三套色板取自 highlight.js 官方主题：GitHub Light / GitHub Dark Dimmed / GitHub Dark。

export interface CodeThemeDef {
  id: string; // data-code-theme 属性值
  t: string;  // 中文名（工具栏弹层用）
  bg: string; // 代码块背景色（弹层预览色片用，与 CSS 变量区保持同步）
}

export const CODE_THEMES: CodeThemeDef[] = [
  { id: 'light', t: '浅灰', bg: '#f6f8fa' },
  { id: 'dark', t: '深灰', bg: '#22272e' },
  { id: 'black', t: '纯黑', bg: '#0d1117' },
];

export const CODE_THEME_DEFAULT = 'light';

const STORAGE_KEY = 'qa-editor-code-theme';

/** 读取持久化的主题选择，非法值回退默认浅灰 */
export function getCodeTheme(): string {
  if (typeof window === 'undefined') return CODE_THEME_DEFAULT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return CODE_THEMES.some(th => th.id === stored) ? (stored as string) : CODE_THEME_DEFAULT;
  } catch {
    return CODE_THEME_DEFAULT;
  }
}

/** 立即应用主题（幂等，不持久化） */
export function applyCodeTheme(theme: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-code-theme', theme);
}

/** 持久化并立即应用（下次打开仍是该主题） */
export function setCodeTheme(theme: string): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级为仅本次会话生效
    }
  }
  applyCodeTheme(theme);
}

/** 页面加载时调用：按持久化选择应用主题（layout 内联脚本已提前应用过一次，这里兜底） */
export function initCodeTheme(): void {
  applyCodeTheme(getCodeTheme());
}
