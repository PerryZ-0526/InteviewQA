'use client';

import type { RefObject } from 'react';
import type { CategoryInfo, ProjectSubdir } from '@/lib/types';
import type { RecentEntry } from '@/lib/recent';

function formatRelativeTime(timestamp: number): string {
  const difference = Date.now() - timestamp;
  if (difference < 60_000) return '刚刚';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (difference < 172_800_000) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Props {
  collapsed: boolean;
  recentOpen: boolean;
  recentList: RecentEntry[];
  recentMenuRef: RefObject<HTMLDivElement>;
  categories: CategoryInfo[];
  projectSubdirs: ProjectSubdir[];
  onGoHome?: () => void;
  onOpenSearch: () => void;
  onOpenLogs?: () => void;
  onOpenRandom?: () => void;
  onToggleRecent: () => void;
  onToggleCollapse?: () => void;
  onCloseRecent: () => void;
  onSelectQuestion: (category: string, filename: string) => void;
  onSelectProgram?: (subdir: string, filename: string) => void;
  onSelectExternalDoc?: (id: string) => void;
}

export default function SidebarHeader({
  collapsed,
  recentOpen,
  recentList,
  recentMenuRef,
  categories,
  projectSubdirs,
  onGoHome,
  onOpenSearch,
  onOpenLogs,
  onOpenRandom,
  onToggleRecent,
  onToggleCollapse,
  onCloseRecent,
  onSelectQuestion,
  onSelectProgram,
  onSelectExternalDoc,
}: Props) {
  return (
    <div className="sidebar-header">
      <div
        ref={recentMenuRef}
        className={`sidebar-header-actions${collapsed ? ' collapsed' : ''}`}
      >
        <button className="sidebar-home-btn" onClick={onGoHome} title="返回首页" aria-label="返回首页">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
            <path d="M10 21v-6h4v6" />
          </svg>
        </button>
        <button className="sidebar-home-btn" onClick={onOpenSearch} title="全文档关键字检索" aria-label="全文档关键字检索">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
          </svg>
        </button>
        <button className="sidebar-home-btn" onClick={onOpenLogs} title="查看操作日志" aria-label="查看操作日志" disabled={!onOpenLogs}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        </button>
        <button className="sidebar-home-btn" onClick={onOpenRandom} title="随机抽取一道题目进行练习" aria-label="随机一题" disabled={!onOpenRandom}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button className="sidebar-home-btn" onClick={onToggleRecent} title="最近浏览" aria-label="最近浏览">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4" />
            <path d="M3 3v4h4" />
            <path d="M12 7v5l3 3" />
          </svg>
        </button>
        {recentOpen && (
          <div className="sidebar-recent-dropdown">
            {recentList.length === 0 ? (
              <div className="sidebar-recent-empty">暂无浏览记录</div>
            ) : recentList.map((item) => {
              const scopeName = item.kind === 'project'
                ? projectSubdirs.find((subdir) => subdir.slug === item.category)?.slug || item.category
                : item.kind === 'external'
                ? '外部文档'
                : categories.find((category) => category.slug === item.category)?.name || item.category;
              return (
                <button
                  key={`${item.kind}:${item.category}/${item.filename}`}
                  className="sidebar-recent-item"
                  onClick={() => {
                    onCloseRecent();
                    if (item.kind === 'project') onSelectProgram?.(item.category, item.filename);
                    else if (item.kind === 'external') onSelectExternalDoc?.(item.filename);
                    else onSelectQuestion(item.category, item.filename);
                  }}
                  title={`${item.title}（${scopeName}）`}
                >
                  <span className="sidebar-recent-title">{item.title}</span>
                  <span className="sidebar-recent-meta">{scopeName} · {formatRelativeTime(item.ts)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button
        className="sidebar-home-btn"
        onClick={onToggleCollapse}
        title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        disabled={!onToggleCollapse}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <path d={collapsed ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'} />
        </svg>
      </button>
    </div>
  );
}
