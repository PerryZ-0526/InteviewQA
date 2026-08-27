'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { isVisibleInLayout } from '@/lib/domScroll';

// 文档内关键字检索：悬浮按钮 + 检索面板。
// 高亮采用 CSS Custom Highlight API（Range + CSS.highlights），
// 不改动编辑器 DOM，对 ProseMirror contenteditable 安全；
// 不支持的浏览器自动降级为「仅计数 + 跳转」。

const MAX_MATCHES = 2000;

/** 遍历文档区可见文本节点，收集所有大小写不敏感命中处的 Range */
function collectMatchRanges(query: string): Range[] {
  const container = document.querySelector('.content');
  if (!container) return [];
  const qLower = query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || !isVisibleInLayout(parent)) continue;
    const tag = parent.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    const text = node.nodeValue || '';
    let idx = text.toLowerCase().indexOf(qLower);
    while (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + query.length);
      ranges.push(range);
      if (ranges.length >= MAX_MATCHES) return ranges;
      idx = text.toLowerCase().indexOf(qLower, idx + query.length);
    }
  }
  return ranges;
}

/** 注册/清除自定义高亮（不支持 Custom Highlight API 时静默跳过） */
function applyHighlights(ranges: Range[], current: number) {
  const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!highlights || !HighlightCtor) return;
  highlights.delete('doc-search-hit');
  highlights.delete('doc-search-hit-current');
  if (ranges.length === 0) return;
  highlights.set('doc-search-hit', new HighlightCtor(...ranges));
  if (current >= 0 && current < ranges.length) {
    highlights.set('doc-search-hit-current', new HighlightCtor(ranges[current]));
  }
}

export default function DocSearchFloat() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [current, setCurrent] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 防抖定时器：输入变化后延迟重搜
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 编辑器 DOM 变化（用户编辑/切换文档）后延迟重搜
  const mutateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSearch = useCallback(() => {
    rangesRef.current = [];
    setMatchCount(0);
    setCurrent(-1);
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    highlights?.delete('doc-search-hit');
    highlights?.delete('doc-search-hit-current');
  }, []);

  /** 执行检索并重建高亮 */
  const runSearch = useCallback((q: string) => {
    if (!q) {
      clearSearch();
      return;
    }
    const ranges = collectMatchRanges(q);
    rangesRef.current = ranges;
    setMatchCount(ranges.length);
    const next = ranges.length > 0 ? 0 : -1;
    setCurrent(next);
    applyHighlights(ranges, next);
    if (next >= 0) scrollRangeIntoView(ranges[next]);
  }, [clearSearch]);

  // 输入防抖：150ms
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(query.trim()), 150);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open, runSearch]);

  // 打开面板时聚焦输入框
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 监听文档区 DOM 变化（编辑、切换标签都会改 DOM）：已有检索词时延迟重搜，保持高亮与内容同步
  useEffect(() => {
    if (!open || !query.trim()) return;
    const container = document.querySelector('.content');
    if (!container) return;
    const observer = new MutationObserver(() => {
      if (mutateTimer.current) clearTimeout(mutateTimer.current);
      mutateTimer.current = setTimeout(() => runSearch(query.trim()), 600);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (mutateTimer.current) clearTimeout(mutateTimer.current);
    };
  }, [open, query, runSearch]);

  // 关闭/卸载时清掉高亮
  useEffect(() => {
    if (!open) clearSearch();
  }, [open, clearSearch]);
  useEffect(() => clearSearch, [clearSearch]);

  /** 滚动某条命中到文档区可视范围（留 80px 顶部空间） */
  const scrollRangeIntoView = (range: Range) => {
    const container = document.querySelector<HTMLElement>('.content');
    if (!container) return;
    const rect = range.getBoundingClientRect();
    const top = rect.top - container.getBoundingClientRect().top + container.scrollTop - 80;
    container.scrollTo({ top, behavior: 'smooth' });
  };

  /** 跳转到第 index 条命中并刷新「当前项」高亮 */
  const goto = useCallback((index: number) => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    const next = ((index % ranges.length) + ranges.length) % ranges.length;
    setCurrent(next);
    applyHighlights(ranges, next);
    scrollRangeIntoView(ranges[next]);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery('');
    clearSearch();
  };

  return (
    <div className="doc-search-float-wrapper">
      <button
        className="doc-search-float"
        onClick={() => (open ? close() : setOpen(true))}
        title="文档内检索（Enter 下一个，Shift+Enter 上一个，Esc 关闭）"
        aria-label="文档内检索"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
      </button>

      {open && (
        <div className="doc-search-popover">
          <input
            ref={inputRef}
            className="doc-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // 无命中时回车重新检索一次（内容可能刚变化）
                if (matchCount === 0) runSearch(query.trim());
                else goto(current + (e.shiftKey ? -1 : 1));
              } else if (e.key === 'Escape') {
                close();
              }
            }}
            placeholder="在当前文档中检索..."
          />
          <span className="doc-search-count" title={`共 ${matchCount} 处命中`}>
            {matchCount > 0 ? `${current + 1} / ${matchCount}` : query.trim() ? '0 结果' : ''}
          </span>
          <button
            className="doc-search-nav-btn"
            onClick={() => goto(current - 1)}
            disabled={matchCount === 0}
            title="上一个 (Shift+Enter)"
            aria-label="上一个"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            className="doc-search-nav-btn"
            onClick={() => goto(current + 1)}
            disabled={matchCount === 0}
            title="下一个 (Enter)"
            aria-label="下一个"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button className="doc-search-nav-btn" onClick={close} title="关闭 (Esc)" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
