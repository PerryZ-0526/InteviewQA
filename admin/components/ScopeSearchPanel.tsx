'use client';

import { useState, useEffect, useRef } from 'react';

// 分类/分组/外部文档分组列表内的关键字检索面板：
// 嵌在 BrowseView / ProjectBrowseView / ExternalBrowseView 的列表卡片头部，
// 有关键词时显示全文命中结果（片段 + 次数），无关键词时不占位、由父级显示完整列表。

export interface ScopeSearchHit {
  kind: 'category' | 'project' | 'external';
  category: string;
  filename?: string;
  /** 仅外部文档命中：索引用 id（外部文档无站内文件名） */
  extId?: string;
  title: string;
  count: number;
  snippet: string;
}

/** 片段中高亮命中的关键字（大小写不敏感，安全渲染，不走 innerHTML） */
function HighlightSnippet({ text, q }: { text: string; q: string }) {
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const idx = lower.indexOf(lq, i);
    if (idx === -1) {
      if (i < text.length) parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={k++}>{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return <>{parts}</>;
}

interface Props {
  // external：外部文档分组内检索，slug 为分组名（空串 = 未分组）
  scope: 'category' | 'project' | 'external';
  slug: string;
  onOpen: (hit: ScopeSearchHit) => void;
  /** 有关键词（检索模式激活）时回调 true，父级据此隐藏完整列表 */
  onActiveChange: (active: boolean) => void;
}

export default function ScopeSearchPanel({ scope, slug, onOpen, onActiveChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScopeSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // 请求序号：只认最后一次请求的结果，防止慢的旧请求覆盖新结果
  const seqRef = useRef(0);

  const trimmed = query.trim();
  const active = trimmed.length > 0;

  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (!trimmed) {
      seqRef.current += 1;
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search-fulltext?q=${encodeURIComponent(trimmed)}&scope=${scope}&slug=${encodeURIComponent(slug)}`
        );
        const json = await res.json();
        if (seq !== seqRef.current) return;
        setResults(json.success ? json.data || [] : []);
      } catch {
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [trimmed, scope, slug]);

  return (
    <>
      <div className="scope-search-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#999' }}>
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
        <input
          className="scope-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="在本目录文档中检索关键字..."
        />
        {query && (
          <button className="scope-search-clear" onClick={() => setQuery('')} title="清空" aria-label="清空">
            ×
          </button>
        )}
      </div>

      {active && (
        <div className="scope-search-results">
          {searching && <div className="scope-search-empty">检索中...</div>}
          {!searching && results && results.length === 0 && (
            <div className="scope-search-empty">「{trimmed}」无匹配文档</div>
          )}
          {!searching && results && results.map((hit) => (
            <div
              key={`${hit.kind}/${hit.category}/${hit.filename}`}
              className="scope-search-item"
              onClick={() => onOpen(hit)}
              title={hit.filename || hit.title}
            >
              <div className="scope-search-item-head">
                {/* 外部文档命中没有站内文件名，隐藏该列 */}
                {hit.filename && <span className="filename">{hit.filename}</span>}
                <span className="scope-search-item-title">{hit.title}</span>
                <span className="scope-search-count-badge">{hit.count} 处</span>
              </div>
              <div className="scope-search-snippet">
                <HighlightSnippet text={hit.snippet} q={trimmed} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
