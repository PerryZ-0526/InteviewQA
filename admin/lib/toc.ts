import { isVisibleInLayout, findVisibleHeading, headingPlainText } from './domScroll';

/** 统一的目录条目结构：顶部目录栏（TocPanel）与悬浮目录按钮（TocFloat）共用 */
export interface TocItem {
  /** 章节锚点 id；编辑器内标题条目为空串，跳转时按文本匹配 */
  id: string;
  label: string;
  /** 相对缩进深度：当前文档最高级标题为 0，后续每级递增 1 */
  level: number;
}

/**
 * 统一的目录提取逻辑：扫描实际渲染出的 DOM，而不是解析 markdown 源文本，
 * 保证目录与页面实际显示的内容一致（代码块内的伪标题、未渲染的内容不会进入目录）。
 *
 * - 多标签系统下隐藏标签保持挂载（display:none），其中的 .doc-section 会污染模式判断：
 *   先按可见性过滤，否则打开过分类题目后，项目文档会被误判为结构化模式、目录收集为空；
 * - 结构化题目：可见章节是虚拟根级（depth 0），章节内 h1-h6 按真实级别递增；
 * - 扁平文档（项目文档等）：扫描 h1-h6，以实际出现的最小 heading level 为 depth 0。
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
        toc.push({ id: secId, label: label.textContent || '', level: 0 });
      } else if (customTitle && secId) {
        // 自定义章节标题是 input，取 value 作为章节名
        toc.push({ id: secId, label: customTitle.value || '未命名', level: 0 });
      }
      const subs = sec.querySelectorAll<HTMLElement>(
        '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .tiptap-editor h5, .tiptap-editor h6',
      );
      for (const el of Array.from(subs)) {
        // headingPlainText：排除反向索引 chip 文本，得到与目录标签可比的纯文本
        const text = headingPlainText(el);
        const headingLevel = Number(el.tagName.slice(1));
        if (text) toc.push({ id: '', label: text, level: headingLevel });
      }
    }
  } else {
    // Flat editor (project docs): scan headings directly
    const headings: { label: string; headingLevel: number }[] = [];
    const editors = Array.from(document.querySelectorAll<HTMLElement>('.tiptap-editor'));
    for (const editor of editors) {
      if (!isVisibleInLayout(editor)) continue;
      const editorHeadings = editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
      for (const el of Array.from(editorHeadings)) {
        const text = headingPlainText(el);
        if (text) headings.push({ label: text, headingLevel: Number(el.tagName.slice(1)) });
      }
    }
    const highestLevel = headings.reduce(
      (minimum, heading) => Math.min(minimum, heading.headingLevel),
      Number.POSITIVE_INFINITY,
    );
    for (const heading of headings) {
      toc.push({
        id: '',
        label: heading.label,
        level: heading.headingLevel - highestLevel,
      });
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
    // 扁平目录项可能来自任意 Markdown heading level。
    const target = findVisibleHeading(
      document,
      '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .tiptap-editor h5, .tiptap-editor h6',
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
