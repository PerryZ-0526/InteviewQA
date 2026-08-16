'use client';

export interface Backlink {
  sourceKind: string;
  sourceCategory: string;
  sourceFilename: string;
  sourceTitle: string;
  linkText: string;
  resolved: { status: string; resolvedPath: string[] } | null;
  contextAnchor: string[];
}

export default function BacklinksPanel({ backlinks }: { backlinks: Backlink[] }) {
  if (backlinks.length === 0) return null;

  return (
    <div style={{ maxWidth: 800, margin: '16px auto 0' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#8c7e9d', marginBottom: 6 }}>
        反向引用 ({backlinks.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {backlinks.map((bl, i) => (
          <button
            key={i}
            className="backlink-item"
            onClick={() => {
              // 跳回源文档：打开源文档并滚动到链接所在的小节
              const srcDocKey = bl.sourceFilename.replace(/\.md$/, '');
              const wiki = [srcDocKey, ...(bl.contextAnchor || [])].filter(Boolean).join('#');
              window.dispatchEvent(new CustomEvent('open-wiki-link', { detail: { wiki } }));
            }}
            title={`跳转到：${bl.sourceTitle}${bl.contextAnchor?.length ? ' → ' + bl.contextAnchor.join(' → ') : ''}`}
          >
            <span className="backlink-title">{bl.sourceTitle}</span>
            {bl.contextAnchor?.length > 0 && (
              <span className="backlink-anchor">→ {bl.contextAnchor.join(' → ')}</span>
            )}
            {(bl.resolved?.status === 'broken' || bl.resolved?.status === 'partial') && (
              <span className="backlink-warn" title="锚点已失效，将跳转到最近的有效层级">失效</span>
            )}
            <span className="backlink-arrow">跳转 ›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
