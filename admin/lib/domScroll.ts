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

/** 滚动文档区容器 .content 到最底部，与 scrollDocToTop 对应 */
export function scrollDocToBottom() {
  const el = document.querySelector<HTMLElement>('.content');
  el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

/**
 * 滚动到元素所在位置，优先滚动文档区容器 .content（页面主滚动容器），
 * 元素不在该容器内时回退到 scrollIntoView。
 * 直接用 scrollIntoView 会先把外层容器跳到顶部再定位元素，造成"先到顶部再跳转"的视觉跳动。
 */
export function scrollElementIntoView(el: HTMLElement) {
  const container = document.querySelector<HTMLElement>('.content');
  if (container && container.contains(el)) {
    // 相对容器顶部对齐，留出 12px 呼吸空间
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
    container.scrollTo({ top, behavior: 'auto' });
    return;
  }
  el.scrollIntoView({ behavior: 'auto', block: 'start' });
}

/**
 * 同步按锚点路径滚动到目标标题（标题已在 DOM 中时使用，如本文档内链接点击）。
 * 从最深一级标题开始向前回退匹配，命中后立即滚动。
 *
 * @param anchors  锚点路径（如 ['二级标题', '三级标题']）
 * @param scope    可选：限定搜索范围（默认整个文档，用于跨多个编辑器实例查找）
 * @returns 是否命中并完成滚动
 */
export function scrollToAnchorPathNow(anchors: string[], scope?: ParentNode): boolean {
  if (anchors.length === 0) {
    scrollDocToTop();
    return true;
  }
  const root = scope ?? document;
  const heads = root.querySelectorAll<HTMLElement>(
    '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .doc-section-label, .doc-custom-title'
  );
  const candidates = Array.from(heads).filter(isVisibleInLayout);
  for (let i = anchors.length - 1; i >= 0; i--) {
    const text = stripMdText(anchors[i]);
    const hit = candidates.find(el => headingMatch(el, text));
    if (hit) {
      console.log('[anchor-nav] 同步命中', { anchor: text, tag: hit.tagName, text: hit.textContent?.slice(0, 30) });
      scrollElementIntoView(hit);
      return true;
    }
  }
  console.log('[anchor-nav] 同步未命中', {
    anchors,
    可见标题数: candidates.length,
    可见标题样例: candidates.slice(0, 8).map(el => `${el.tagName}:${el.textContent?.slice(0, 20)}`),
  });
  return false;
}

/**
 * 按锚点路径（标题文本数组，支持逐级回退）滚动到目标标题。
 * Tiptap 标题是异步渲染的（新标签挂载后需若干帧才出现），故用短间隔轮询：
 * 一旦命中目标立即滚动并结束；在标题尚未渲染时持续重试，而不是直接回退到文档顶部。
 *
 * @param anchors  锚点路径（如 ['二级标题', '三级标题']），从最深一级开始向前回退
 * @param onDone   滚动结束（命中或超时）回调
 * @returns        取消函数（组件卸载/锚点变更时调用，清掉轮询定时器）
 */
export function scrollToAnchorPathPolling(
  anchors: string[],
  onDone?: () => void,
): () => void {
  if (anchors.length === 0) {
    scrollDocToTop();
    onDone?.();
    return () => {};
  }
  let cancelled = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 60; // 约 1s（每帧约 16ms），覆盖编辑器异步挂载
  // 用 requestAnimationFrame 在每帧绘制前检测：标题一旦进入 DOM，
  // 就在同一帧绘制前完成滚动，避免出现"先停在顶部、下一帧再跳到标题"的闪烁
  const attempt = () => {
    if (cancelled) return;
    const heads = document.querySelectorAll<HTMLElement>(
      '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .doc-section-label, .doc-custom-title'
    );
    const candidates = Array.from(heads).filter(isVisibleInLayout);
    for (let i = anchors.length - 1; i >= 0; i--) {
      const text = stripMdText(anchors[i]);
      const hit = candidates.find(el => headingMatch(el, text));
      if (hit) {
        console.log('[anchor-nav] 轮询命中', { anchor: text, 第几次尝试: attempts + 1, tag: hit.tagName });
        scrollElementIntoView(hit);
        onDone?.();
        return;
      }
    }
    const hasRenderedHeadings = candidates.some(el => el.matches('h1,h2,h3,h4'));
    attempts += 1;
    if (!hasRenderedHeadings && attempts < MAX_ATTEMPTS) {
      requestAnimationFrame(attempt);
      return;
    }
    console.log('[anchor-nav] 轮询放弃回顶部', {
      anchors,
      attempts,
      已渲染标题数: candidates.length,
      可见标题样例: candidates.slice(0, 8).map(el => `${el.tagName}:${el.textContent?.slice(0, 20)}`),
    });
    // 标题已渲染但锚点确实不存在（失效链接）：回到顶部
    scrollDocToTop();
    onDone?.();
  };
  requestAnimationFrame(attempt);
  return () => { cancelled = true; };
}

/**
 * 标题元素的纯文本。textContent 的问题：
 * - 反向索引 chip 是挂在标题节点内的挂件，其「↩ N」文本会混入 textContent；
 * - wiki 链接 mark 渲染为字面 [[...]] 文本，需要按 markdown 规则剥掉；
 * - 分类文档里的自定义章节 H2 被解析成 <input class="doc-custom-title">，
 *   其文本在 value 上而非 textContent，直接取会匹配失败而回退到顶部。
 * 目录显示与跳转匹配统一从这里取文本，保证与 md 侧 stripMdText 的结果可比。
 */
export function headingPlainText(el: HTMLElement): string {
  // 自定义章节标题是 <input>，文本在 value 上
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return stripMdText((el as HTMLInputElement).value || '');
  }
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
