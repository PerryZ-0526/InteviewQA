'use client';

import { useEffect, useRef } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

interface Props {
  tabs: TabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose, onCloseAll }: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);

  // 鼠标滚轮横向滚动标签栏：原生非 passive 监听才能 preventDefault 阻止页面纵向滚动。
  // 依赖 tabs.length：标签栏在无标签时 unmount，长度从 0 变非 0 时需重新挂载监听。
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // 横向没有溢出时放行，不劫持页面滚动
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [tabs.length]);

  // 激活标签变化（含 MRU 移到最前、新开标签）时滚动到可见区域；已在视口内则不动
  useEffect(() => {
    if (!activeId) return;
    const tabEl = barRef.current?.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);
    tabEl?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeId, tabs]);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar" ref={barRef}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          data-tab-id={tab.id}
          className={`tab-item ${tab.id === activeId ? 'active' : ''}`}
          onClick={() => onSelect(tab.id)}
          title={tab.label}
        >
          <span className="tab-label">{tab.label}</span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            title="关闭标签"
          >
            ×
          </span>
        </div>
      ))}
      <div className="tab-bar-actions">
        <button className="tab-close-all" onClick={onCloseAll} title="关闭全部标签页">
          ✕ 关闭全部
        </button>
      </div>
    </div>
  );
}
