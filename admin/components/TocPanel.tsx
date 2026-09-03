'use client';

import { useEffect, useState } from 'react';
import { extractTocItems, jumpToTocItem, tocEquals, type TocItem } from '@/lib/toc';

/**
 * 顶部目录栏。与悬浮目录按钮（TocFloat）共用 lib/toc.ts 的 DOM 提取逻辑，
 * 不再从 markdown 源文本解析标题，保证两处目录内容完全一致。
 *
 * Tiptap 标题是异步渲染的、且会随编辑变化，因此挂载后除了首次扫描，
 * 还通过 MutationObserver + input 事件（捕获阶段，覆盖 contenteditable
 * 与 input.value 的变化）防抖刷新；结果未变时不触发重渲染。
 */
export default function TocPanel() {
  const [items, setItems] = useState<TocItem[]>([]);

  useEffect(() => {
    const refresh = () => {
      const next = extractTocItems();
      setItems(prev => (tocEquals(prev, next) ? prev : next));
    };
    refresh();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('input', schedule, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('input', schedule, true);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (items.length === 0) return null;

  // 按 level 1 条目切组，保持「每章节一块」的视觉结构
  const groups: TocItem[][] = [];
  for (const item of items) {
    if (item.level === 1 || groups.length === 0) groups.push([item]);
    else groups[groups.length - 1].push(item);
  }
  const summary = `${groups.length} 个章节`;

  return (
    <nav className="toc-panel" aria-label="文档目录">
      <div className="toc-heading">
        <div>
          <span className="toc-eyebrow">CONTENTS</span>
          <div className="toc-title">内容导航</div>
        </div>
        <span className="toc-summary">{summary}</span>
      </div>
      <div className="toc-list">
        {groups.map((group, groupIndex) => (
          <div className="toc-group" key={groupIndex}>
            {group.map((item, itemIndex) => (
              <a
                key={`${item.label}-${itemIndex}`}
                href={item.id ? `#${item.id}` : '#'}
                className={`toc-item toc-l${item.level}`}
                onClick={(e) => {
                  e.preventDefault();
                  jumpToTocItem(item);
                }}
              >
                <span className="toc-num">{item.level === 1 ? String(groupIndex + 1).padStart(2, '0') : '—'}</span>
                <span className="toc-label" title={item.label}>{item.label}</span>
                {item.level === 1 && <span className="toc-arrow" aria-hidden="true">↘</span>}
              </a>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
