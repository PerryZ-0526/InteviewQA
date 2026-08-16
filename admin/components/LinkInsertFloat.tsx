'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { getActiveEditor } from '@/lib/activeEditor';

interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}

interface DocResult {
  kind: string;
  category: string;
  filename: string;
  title: string;
  headings: HeadingNode[];
}

export default function LinkInsertFloat() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json();
      if (json.success) setResults(json.data || []);
    } catch {}
    setSearching(false);
  }, []);

  const onQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 250);
  };

  const insertWikiLink = (wiki: string) => {
    const editor = getActiveEditor();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().insertContent({
        type: 'text',
        text: `[[${wiki}]]`,
        marks: [{ type: 'wikiLink', attrs: { wiki } }],
      }).run();
    }
    setOpen(false);
    setQuery('');
    setResults([]);
    setExpandedDoc(null);
  };

  const docKey = (f: string) => f.replace(/\.md$/, '');

  return (
    <div className="link-float-wrapper">
      <button
        className="link-float"
        onClick={() => setOpen(!open)}
        title="插入索引链接"
        aria-label="插入索引链接"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
      </button>

      {open && (
        <div className="link-float-popover">
          <div className="link-float-head">插入索引链接</div>
          <input
            ref={inputRef}
            className="link-float-input"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            placeholder="搜索文档标题或文件名..."
          />
          <div className="link-float-results">
            {searching && <div className="link-float-empty">搜索中...</div>}
            {!searching && results.length === 0 && query.trim() && (
              <div className="link-float-empty">无匹配文档</div>
            )}
            {!searching && results.length === 0 && !query.trim() && (
              <div className="link-float-empty">输入关键词搜索全量文档</div>
            )}
            {results.map((doc) => (
              <div key={`${doc.kind}/${doc.category}/${doc.filename}`} className="link-float-doc">
                <button
                  className="link-float-doc-title"
                  onClick={() => setExpandedDoc(expandedDoc === doc.filename ? null : doc.filename)}
                >
                  <span className="link-float-doc-name" title={doc.title}>{doc.title}</span>
                  <span className="link-float-doc-badge">{doc.kind === 'category' ? '题' : '文'}</span>
                </button>
                {expandedDoc === doc.filename && (
                  <div className="link-float-tree">
                    <button
                      className="link-float-tree-item"
                      onClick={() => insertWikiLink(docKey(doc.filename))}
                    >
                      整篇文档
                    </button>
                    {doc.headings.map((h, i) => (
                      <HeadingTreeItem
                        key={i}
                        node={h}
                        path={[h.text]}
                        docKey={docKey(doc.filename)}
                        onInsert={insertWikiLink}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HeadingTreeItem({ node, path, docKey, onInsert }: {
  node: HeadingNode;
  path: string[];
  docKey: string;
  onInsert: (wiki: string) => void;
}) {
  return (
    <div>
      <button
        className="link-float-tree-item"
        style={{ paddingLeft: 12 + (node.level - 2) * 14 }}
        onClick={() => onInsert(`${docKey}#${path.join('#')}`)}
        title={node.text}
      >
        <span className="link-float-tree-level">H{node.level}</span>
        <span className="link-float-tree-text">{node.text}</span>
      </button>
      {node.children.map((child, i) => (
        <HeadingTreeItem
          key={i}
          node={child}
          path={[...path, child.text]}
          docKey={docKey}
          onInsert={onInsert}
        />
      ))}
    </div>
  );
}
