'use client';

import { scrollDocToBottom } from '@/lib/domScroll';

/** 侧边悬浮按钮：滚动文档区到最底部（与 BackToTop 成对，样式同列） */
export default function GoToBottom() {
  return (
    <button
      className="go-to-bottom"
      onClick={scrollDocToBottom}
      title="去到底部"
      aria-label="去到底部"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="19 12 12 19 5 12" />
      </svg>
    </button>
  );
}
