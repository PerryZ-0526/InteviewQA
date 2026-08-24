// 编辑器统一调色板：字体颜色 / 标题颜色 / 下划线颜色共用同一组色号。
// 黑色为默认态——序列化时不写颜色样式（输出干净的 markdown）；其余颜色写入对应 style 属性。
// 色号调整只需改本文件的 EDITOR_COLORS，三处功能与已持久化的选择自动跟随，避免分散维护。

export interface EditorColorDef {
  v: string; // CSS 颜色值
  t: string; // 中文名（弹层选项与提示用）
  k?: string; // 字体颜色快捷键字母（Ctrl+Alt+字母）
}

/** 统一五色 + 黑（默认态）。未来统一改色号只动这一张表 */
export const EDITOR_COLORS: EditorColorDef[] = [
  { v: '#000000', t: '黑' },
  { v: '#e63946', t: '红', k: 'R' },
  { v: '#2563eb', t: '蓝', k: 'B' },
  { v: '#f59e0b', t: '黄', k: 'Y' },
  { v: '#16a34a', t: '绿', k: 'G' },
  { v: '#7c3aed', t: '紫', k: 'P' },
];

export const EDITOR_COLOR_DEFAULT = '#000000';

/** 颜色用途：各自独立持久化，色板共享 */
export type ColorPurpose = 'font' | 'heading' | 'underline';

const STORAGE_KEYS: Record<ColorPurpose, string> = {
  font: 'qa-editor-font-color',
  heading: 'qa-editor-heading-color',
  underline: 'qa-editor-underline-color', // 沿用既有 key，过往选择无缝延续
};

// 旧调色板 → 新调色板的迁移映射：调整色号后，已持久化的选择自动跟随新色，不会回退默认黑色
const LEGACY_COLOR_MAP: Record<string, string> = {
  '#e03131': '#e63946',
  '#4c6ef5': '#2563eb',
  '#eab308': '#f59e0b',
  '#f08c00': '#f59e0b', // 旧字体颜色「橙」→ 新色板「黄」
  '#2f9e44': '#16a34a',
  '#7950f2': '#7c3aed',
};

/** 读取持久化的颜色选择，非法值回退默认黑色；旧色号自动迁移到新色号 */
export function getEditorColor(purpose: ColorPurpose): string {
  if (typeof window === 'undefined') return EDITOR_COLOR_DEFAULT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS[purpose]);
    if (!stored) return EDITOR_COLOR_DEFAULT;
    const migrated = LEGACY_COLOR_MAP[stored];
    if (migrated) {
      window.localStorage.setItem(STORAGE_KEYS[purpose], migrated);
      return migrated;
    }
    return EDITOR_COLORS.some(c => c.v === stored) ? stored : EDITOR_COLOR_DEFAULT;
  } catch {
    return EDITOR_COLOR_DEFAULT;
  }
}

/** 持久化颜色选择（下次打开仍是该颜色） */
export function setEditorColor(purpose: ColorPurpose, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEYS[purpose], value);
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅本次会话生效
  }
}

/** 黑色为默认态 → 不写颜色属性（null），其余颜色原样返回 */
export function toColorAttr(value: string): string | null {
  return value === EDITOR_COLOR_DEFAULT ? null : value;
}
