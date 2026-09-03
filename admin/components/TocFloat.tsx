'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { extractTocItems, jumpToTocItem, type TocItem } from '@/lib/toc';

export default function TocFloat() {
  const [open, setOpen] = useState(false);
  const [sticky, setSticky] = useState(false);
  const [items, setItems] = useState<TocItem[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    // 与顶部目录栏共用同一套基于 DOM 的目录提取逻辑（见 lib/toc.ts）
    setItems(extractTocItems());
  }, [open]);

  const jump = useCallback((item: TocItem) => {
    setOpen(false);
    setSticky(false);
    jumpToTocItem(item);
  }, []);

  const enter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };

  const leave = () => {
    if (sticky) return;
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const toggleSticky = () => {
    if (sticky) {
      setSticky(false);
      setOpen(false);
    } else {
      setSticky(true);
      setOpen(true);
    }
  };

  return (
    <div className="toc-float-wrapper" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        className="toc-float"
        onClick={toggleSticky}
        title="目录（点击固定，悬浮预览）"
        aria-label="目录"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>

      {open && items.length > 0 && (
        <div className="toc-float-popover" onMouseEnter={enter} onMouseLeave={leave}>
          {items.map((item, i) => (
            <button
              key={i}
              className={`toc-float-item toc-float-l${item.level}`}
              onClick={() => jump(item)}
              title={item.label}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
