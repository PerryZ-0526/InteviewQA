import { isVisibleInLayout, findVisibleHeading, headingPlainText } from './domScroll';

/** 统一的目录条目结构：顶部目录栏（TocPanel）与悬浮目录按钮（TocFloat）共用 */
export interface TocItem {
  /** 章节锚点 id；编辑器内标题条目为空串，跳转时按文本匹配 */
  id: string;
  label: string;
  level: 1 | 2;
}

/**
 * 统一的目录提取逻辑：扫描实际渲染出的 DOM，而不是解析 markdown 源文本，
 * 保证目录与页面实际显示的内容一致（代码块内的伪标题、未渲染的内容不会进入目录）。
 *
 * - 多标签系统下隐藏标签保持挂载（display:none），其中的 .doc-section 会污染模式判断：
 *   先按可见性过滤，否则打开过分类题目后，项目文档会被误判为结构化模式、目录收集为空；
 * - 结构化题目：以 doc-section + doc-section-label / doc-custom-title 为章节（level 1），
 *   章节内编辑器 h2/h3 为子项（level 2）；
 * - 扁平文档（项目文档等）：直接扫描可见编辑器内的 h1/h2/h3，h1/h2 为 level 1、h3 为 level 2。
 */
export function extractTocItems(): TocItem[] {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.doc-section')).filter(isVisibleInLayout);
  const toc: TocItem[] = [];

  if (sections.length > 0) {
    // Structured interview question editor: doc-section + doc-section-label
    for (const sec of sections) {
      const label = sec.querySelector<HTMLElement>('.doc-section-label');
      const customTitle = sec.querySelector<HTMLInputElement>('.doc-custom-title');
      const secId = sec.id || label?.id || '';
      if (label && secId) {
        toc.push({ id: secId, label: label.textContent || '', level: 1 });
      } else if (customTitle && secId) {
        // 自定义章节标题是 input，取 value 作为章节名
        toc.push({ id: secId, label: customTitle.value || '未命名', level: 1 });
      }
      const subs = sec.querySelectorAll<HTMLElement>('.tiptap-editor h2, .tiptap-editor h3');
      for (const el of Array.from(subs)) {
        // headingPlainText：排除反向索引 chip 文本，得到与目录标签可比的纯文本
        const text = headingPlainText(el);
        if (text) toc.push({ id: '', label: text, level: 2 });
      }
    }
  } else {
    // Flat editor (project docs): scan headings directly
    const editors = Array.from(document.querySelectorAll<HTMLElement>('.tiptap-editor'));
    for (const editor of editors) {
      if (!isVisibleInLayout(editor)) continue;
      const headings = editor.querySelectorAll<HTMLElement>('h1, h2, h3');
      for (const el of Array.from(headings)) {
        const text = headingPlainText(el);
        if (text) {
          const level = el.tagName === 'H3' ? 2 : 1;
          toc.push({ id: '', label: text, level });
        }
      }
    }
  }
  return toc;
}

/** 统一的目录跳转逻辑：章节条目按 id 定位，标题条目按文本匹配可见标题 */
export function jumpToTocItem(item: TocItem) {
  if (item.id) {
    const target = document.getElementById(item.id);
    if (isVisibleInLayout(target)) {
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  } else {
    // 扁平目录项可能来自 h1/h2（项目文档常见），不能只搜 h3
    const target = findVisibleHeading(
      document,
      '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4',
      item.label,
    );
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

/** 比较两次目录提取结果是否一致，供观察器回调避免无意义的重渲染 */
export function tocEquals(a: TocItem[], b: TocItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].label !== b[i].label || a[i].level !== b[i].level) return false;
  }
  return true;
}
