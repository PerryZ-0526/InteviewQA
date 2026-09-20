'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import WysiwygEditor from './WysiwygEditor';
import TocPanel from './TocPanel';
import { stripMdText } from '@/lib/stripText';
import { useTocPref } from '@/lib/useTocPref';
import { useAutosave } from '@/lib/useAutosave';
import { useDocumentLoader } from '@/lib/useDocumentLoader';

const AUTO_SAVE_DELAY = 400;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

interface Props {
  id: string;
  onBack: () => void;
  onSaveStatusChange?: (status: string) => void;
  onSaved?: () => void;
}

export default function ExternalDocView({ id, onBack, onSaveStatusChange, onSaved }: Props) {
  const [missing, setMissing] = useState(false);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [displayTitle, setDisplayTitle] = useState('');
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  // 目录显隐：按文档独立持久化，下次打开同一文档仍保持上次的状态
  const { showToc, toggleToc } = useTocPref(`external:${id}`);
  const contentRef = useRef('');
  const titleRef = useRef('');
  const buildSaveValue = useCallback(() => {
    const body = `# ${titleRef.current}\n\n${contentRef.current}`;
    const frontmatterLines = Object.entries(frontmatter)
      .filter(([key, value]) => key !== 'title' && value)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    return frontmatterLines ? `---\n${frontmatterLines}\n---\n\n${body}` : body;
  }, [frontmatter]);
  const saveDocument = useCallback(async (full: string) => {
    try {
      const response = await fetch(`/api/external/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: full }),
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json.success) {
        setMtimeMs(Date.now());
        onSaved?.();
        return true;
      }
      if (json.path) {
        setMissing(true);
        setPath(json.path);
      }
      return false;
    } catch {
      return false;
    }
  }, [id, onSaved]);
  const { status: saveStatus, schedule: scheduleSave, reset: resetSave } = useAutosave({
    delay: AUTO_SAVE_DELAY,
    buildValue: buildSaveValue,
    save: saveDocument,
  });
  const loadDocument = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/external/${encodeURIComponent(id)}`, { signal });
    const json = await response.json();
    if (!response.ok || !json.success) {
      const error = new Error(json.error || '文档加载失败') as Error & { path?: string };
      error.path = json.path;
      throw error;
    }
    return json as { data: string; path: string; mtimeMs: number | null };
  }, [id]);
  const { data: loadedDocument, loading, error: loadError } = useDocumentLoader(id, loadDocument);

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存', error: '保存失败' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);

  useEffect(() => {
    setMissing(false);
    setPath('');
    setContent('');
    contentRef.current = '';
    setDisplayTitle('');
    titleRef.current = '';
    setFrontmatter({});
    setMtimeMs(null);
    resetSave();
  }, [id, resetSave]);

  useEffect(() => {
    if (loadError) {
      setMissing(true);
      setPath((loadError as Error & { path?: string }).path || '');
      return;
    }
    if (!loadedDocument) return;
    const raw = loadedDocument.data;
    let parsedFrontmatter: Record<string, string> = {};
    let body = raw;
    if (raw.startsWith('---')) {
      const end = raw.indexOf('---', 3);
      if (end > 0) {
        const frontmatterText = raw.slice(3, end).trim();
        for (const line of frontmatterText.split('\n')) {
          const colon = line.indexOf(':');
          if (colon > 0) parsedFrontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
        }
        body = raw.slice(end + 3).trimStart();
      }
    }
    let title = basename(loadedDocument.path);
    body = body.trimStart();
    const heading = body.match(/^#\s+(.+)/m);
    if (heading) {
      title = stripMdText(heading[1]);
      body = body.slice(body.indexOf('\n', heading.index!) + 1).trimStart();
    }
    setFrontmatter(parsedFrontmatter);
    setDisplayTitle(title);
    titleRef.current = title;
    setContent(body);
    contentRef.current = body;
    setPath(loadedDocument.path);
    setMtimeMs(loadedDocument.mtimeMs ?? null);
  }, [loadError, loadedDocument]);

  const handleTitleChange = useCallback((val: string) => {
    setDisplayTitle(val);
    titleRef.current = val;
    scheduleSave();
  }, [scheduleSave]);

  const handleChange = useCallback((md: string) => {
    contentRef.current = md;
    scheduleSave();
  }, [scheduleSave]);

  if (loading) {
    return (
      <div className="loading-overlay" style={{ padding: 40 }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (missing) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <h3 style={{ color: '#e03131', marginBottom: 12 }}>索引失效</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            文件已被移动、重命名或删除，无法打开。
          </p>
          {path && (
            <p className="external-path" style={{ marginBottom: 20, wordBreak: 'break-all' }}>
              原位置：{path}
            </p>
          )}
          <button className="btn btn-primary" onClick={onBack}>返回</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="tag-viewer-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="doc-title-input"
            value={displayTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="文档标题"
            spellCheck={false}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#999', wordBreak: 'break-all' }}>{path}</span>
            {mtimeMs != null && (
              <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>修改：{fmtTime(mtimeMs)}</span>
            )}
          </div>
        </div>
        {/* 目录切换按钮：统一放在头部右上角，与题目视图（DocumentEditor）样式一致 */}
        <button
          className="btn btn-small btn-secondary doc-toc-toggle"
          data-expanded={showToc}
          aria-expanded={showToc}
          onClick={toggleToc}
          title={showToc ? '隐藏目录' : '展开目录'}
          style={{ alignSelf: 'flex-start', flexShrink: 0 }}
        >
          {showToc ? '隐藏目录' : '目录'}
        </button>
      </div>

      {showToc && <TocPanel />}

      <WysiwygEditor
        key={id}
        initialMarkdown={content}
        onChange={handleChange}
        documentTitle={displayTitle}
        sectionName={displayTitle}
      />
    </div>
  );
}
