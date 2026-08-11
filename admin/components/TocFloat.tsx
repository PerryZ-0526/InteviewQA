'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export default function TocFloat() {
  const [open, setOpen] = useState(false);
  const [sticky, setSticky] = useState(false);
  const [items, setItems] = useState<{ id: string; label: string; level: 1 | 2 }[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const sections = document.querySelectorAll<HTMLElement>('.doc-section');
    const toc: { id: string; label: string; level: 1 | 2 }[] = [];

    if (sections.length > 0) {
      // Structured interview question editor: doc-section + doc-section-label
      for (const sec of Array.from(sections)) {
        const label = sec.querySelector<HTMLElement>('.doc-section-label');
        const secId = sec.id || label?.id || '';
        if (label && secId) toc.push({ id: secId, label: label.textContent || '', level: 1 });
        const subs = sec.querySelectorAll<HTMLElement>('.tiptap-editor h2, .tiptap-editor h3');
        for (const el of Array.from(subs)) {
          if (el.textContent) toc.push({ id: '', label: el.textContent.trim(), level: 2 });
        }
      }
    } else {
      // Flat editor (project docs): scan headings directly
      const editors = document.querySelectorAll<HTMLElement>('.tiptap-editor');
      for (const editor of Array.from(editors)) {
        const headings = editor.querySelectorAll<HTMLElement>('h1, h2, h3');
        for (const el of Array.from(headings)) {
          if (el.textContent) {
            const level = el.tagName === 'H1' ? 1 : el.tagName === 'H2' ? 1 : 2;
            toc.push({ id: '', label: el.textContent.trim(), level: level as 1 | 2 });
          }
        }
      }
    }
    setItems(toc);
  }, [open]);

  const jump = useCallback((id: string, label: string) => {
    setOpen(false);
    setSticky(false);
    if (id) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      const h3s = document.querySelectorAll('.tiptap-editor h3');
      for (const el of h3s) {
        if (el.textContent?.trim() === label) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
    }
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
              onClick={() => jump(item.id, item.label)}
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
