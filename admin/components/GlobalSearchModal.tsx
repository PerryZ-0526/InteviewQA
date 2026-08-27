'use client';

import { useState, useEffect, useRef } from 'react';

// 全库关键字检索弹窗：检索范围 = 全部分类 + project 子目录 + 分组 + 外部文档。
// 入口在侧边栏「返回首页」按钮旁，结果点击直达对应文档。

interface FullTextHit {
  kind: 'category' | 'project' | 'external';
  category: string;
  filename?: string;
  extId?: string;
  title: string;
  count: number;
  snippet: string;
}

interface Props {
  onClose: () => void;
  onSelectQuestion: (category: string, filename: string) => void;
  onSelectProgram: (subdir: string, filename: string) => void;
  onSelectExternalDoc: (id: string) => void;
}

/** 来源徽标文案 */
function kindLabel(hit: FullTextHit): string {
  if (hit.kind === 'category') return `分类 · ${hit.category}`;
  if (hit.kind === 'project') return `分组 · ${hit.category}`;
  return '外部文档';
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

export default function GlobalSearchModal({ onClose, onSelectQuestion, onSelectProgram, onSelectExternalDoc }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FullTextHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // 请求序号：只认最后一次请求的结果，防止慢的旧请求覆盖新结果
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();

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
        const res = await fetch(`/api/search-fulltext?q=${encodeURIComponent(trimmed)}`);
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
  }, [trimmed]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 打开命中的文档并关闭弹窗 */
  const openHit = (hit: FullTextHit) => {
    onClose();
    if (hit.kind === 'category' && hit.filename) onSelectQuestion(hit.category, hit.filename);
    else if (hit.kind === 'project' && hit.filename) onSelectProgram(hit.category, hit.filename);
    else if (hit.kind === 'external' && hit.extId) onSelectExternalDoc(hit.extId);
  };

  return (
    <div className="sidebar-modal-overlay" onClick={onClose}>
      <div className="sidebar-modal global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sidebar-modal-title">全文档检索</div>
        <div className="sidebar-modal-body global-search-body">
          <input
            ref={inputRef}
            className="sidebar-modal-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="检索全部分类、分组与外部文档..."
          />
          <div className="global-search-results">
            {!trimmed && (
              <div className="global-search-empty">输入关键字，检索范围：全部分类 + project + 分组 + 外部文档</div>
            )}
            {trimmed && searching && <div className="global-search-empty">检索中...</div>}
            {trimmed && !searching && results && results.length === 0 && (
              <div className="global-search-empty">「{trimmed}」无匹配文档</div>
            )}
            {trimmed && !searching && results && results.map((hit) => (
              <div
                key={`${hit.kind}/${hit.category}/${hit.filename || hit.extId}`}
                className="global-search-item"
                onClick={() => openHit(hit)}
                title={hit.filename || hit.title}
              >
                <div className="global-search-item-head">
                  <span className="global-search-kind-badge">{kindLabel(hit)}</span>
                  <span className="global-search-item-title">{hit.title}</span>
                  <span className="scope-search-count-badge">{hit.count} 处</span>
                </div>
                <div className="scope-search-snippet">
                  <HighlightSnippet text={hit.snippet} q={trimmed} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="sidebar-modal-actions">
          <div style={{ flex: 1 }} />
          <button className="btn btn-small btn-secondary" onClick={onClose}>关闭 (Esc)</button>
        </div>
      </div>
    </div>
  );
}
