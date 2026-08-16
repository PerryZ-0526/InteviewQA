'use client';

import { isVisibleInLayout, scrollDocToTop } from '@/lib/domScroll';

export default function BackToTop() {
  return (
    <button
      className="back-to-top"
      onClick={() => {
        // 多标签下隐藏面板仍在 DOM 中，需跳过不可见的 header
        const headers = document.querySelectorAll<HTMLElement>('.doc-header, .tag-viewer-header');
        for (const header of Array.from(headers)) {
          if (isVisibleInLayout(header)) {
            header.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
        scrollDocToTop();
      }}
      title="回到顶部"
      aria-label="回到顶部"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
