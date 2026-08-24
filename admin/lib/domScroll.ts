import { stripMdText } from './stripText';

/**
 * 多标签场景下，所有打开的文档面板都保留在 DOM 中（隐藏面板 display:none）。
 * 全局 querySelectorAll 会命中隐藏面板里的同名标题，导致目录跳转失效。
 * 用 offsetParent 判断元素是否参与可见布局。
 */
export function isVisibleInLayout(el: Element | null): el is HTMLElement {
  return !!el && (el as HTMLElement).offsetParent !== null;
}

/** 文档区滚动容器是 .content（body 固定不滚动），回到顶部统一走这里 */
export function scrollDocToTop() {
  document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 标题元素的纯文本。textContent 的问题：
 * - 反向索引 chip 是挂在标题节点内的挂件，其「↩ N」文本会混入 textContent；
 * - wiki 链接 mark 渲染为字面 [[...]] 文本，需要按 markdown 规则剥掉。
 * 目录显示与跳转匹配统一从这里取文本，保证与 md 侧 stripMdText 的结果可比。
 */
export function headingPlainText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.backlink-chip-wrapper').forEach(n => n.remove());
  return stripMdText(clone.textContent || '');
}

/** 标题元素文本与（已 strip 的）目录标签是否一致 */
export function headingMatch(el: HTMLElement, label: string): boolean {
  return headingPlainText(el) === label;
}

/** 在范围内查找参与可见布局且文本匹配的标题元素 */
export function findVisibleHeading(
  root: ParentNode,
  selector: string,
  label: string
): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(selector);
  for (const el of Array.from(all)) {
    if (!isVisibleInLayout(el)) continue;
    if (headingMatch(el, label)) return el;
  }
  return null;
}
