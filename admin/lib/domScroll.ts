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

/** 在范围内查找参与可见布局且文本匹配的标题元素 */
export function findVisibleHeading(
  root: ParentNode,
  selector: string,
  label: string
): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(selector);
  for (const el of Array.from(all)) {
    if (!isVisibleInLayout(el)) continue;
    if ((el.textContent || '').trim() === label) return el;
  }
  return null;
}
