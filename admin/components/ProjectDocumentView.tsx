'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import WysiwygEditor, { BacklinkEntry } from './WysiwygEditor';
import TocPanel from './TocPanel';
import BacklinksPanel, { Backlink } from './BacklinksPanel';
import { stripMdText } from '@/lib/stripText';
import { scrollToAnchorPathPolling } from '@/lib/domScroll';
import { useTocPref } from '@/lib/useTocPref';
import { useAutosave } from '@/lib/useAutosave';
import { useDocumentLoader } from '@/lib/useDocumentLoader';

const AUTO_SAVE_DELAY = 400;

function fmtTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  subdir: string;
  filename: string;
  onBack: () => void;
  onSaved?: () => void;
  onSaveStatusChange?: (status: string) => void;
  pendingAnchor?: string[] | null;
  onAnchorDone?: () => void;
}

export default function ProjectDocumentView({ subdir, filename, onBack, onSaved, onSaveStatusChange, pendingAnchor, onAnchorDone }: Props) {
  const [docBase, setDocBase] = useState('project');
  const uploadDir = `${docBase}/${subdir}`;
  const imageBase = `/api/raw/${docBase}/${encodeURIComponent(subdir)}`;
  const [content, setContent] = useState('');
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [displayTitle, setDisplayTitle] = useState('');
  // 目录显隐：按文档独立持久化，下次打开同一文档仍保持上次的状态
  const { showToc, toggleToc } = useTocPref(`project:${subdir}/${filename}`);
  const [createdAt, setCreatedAt] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const contentRef = useRef('');
  const titleRef = useRef('');
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');
  const buildSaveValue = useCallback(() => {
    const now = fmtTime(new Date());
    updatedAtRef.current = now;
    const body = `# ${titleRef.current}\n\n${contentRef.current}\n\n<!-- created: ${createdAtRef.current} -->\n<!-- updated: ${now} -->`;
    const frontmatterLines = Object.entries(frontmatter)
      .filter(([key, value]) => key !== 'title' && key !== 'created' && key !== 'updated' && value)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    return frontmatterLines ? `---\n${frontmatterLines}\n---\n\n${body}` : body;
  }, [frontmatter]);
  const saveDocument = useCallback(async (full: string) => {
    try {
      const response = await fetch(`/api/project/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: full }),
      });
      if (!response.ok) return false;
      setUpdatedAt(updatedAtRef.current);
      onSaved?.();
      return true;
    } catch {
      return false;
    }
  }, [filename, onSaved, subdir]);
  const { status: saveStatus, schedule: scheduleSave, reset: resetSave } = useAutosave({
    delay: AUTO_SAVE_DELAY,
    buildValue: buildSaveValue,
    save: saveDocument,
  });
  const loadDocument = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/project/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`, { signal });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || '文档加载失败');
    return json as { data: string; mtimeMs: number | null; base: string };
  }, [filename, subdir]);
  const { data: loadedDocument, loading } = useDocumentLoader(`${subdir}/${filename}`, loadDocument);

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存', error: '保存失败' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);

  useEffect(() => {
    setDisplayTitle('');
    setContent('');
    contentRef.current = '';
  }, [subdir, filename, resetSave]);

  useEffect(() => {
    if (!loadedDocument) return;
    const raw = loadedDocument.data;
    const mtimeMs = loadedDocument.mtimeMs;
    if (loadedDocument.base) setDocBase(loadedDocument.base);
    let parsedFrontmatter: Record<string, string> = {};
    let body = raw;
    let created = raw.match(/<!--\s*created:\s*(.+?)\s*-->/)?.[1]?.trim() || '';
    let updated = raw.match(/<!--\s*updated:\s*(.+?)\s*-->/)?.[1]?.trim() || '';

    if (raw.startsWith('---')) {
      const end = raw.indexOf('---', 3);
      if (end > 0) {
        const frontmatterText = raw.slice(3, end).trim();
        for (const line of frontmatterText.split('\n')) {
          const colon = line.indexOf(':');
          if (colon > 0) parsedFrontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
        }
        body = raw.slice(end + 3).trimStart();
        if (!created && parsedFrontmatter.created) created = parsedFrontmatter.created;
      }
    }
    if (!created && mtimeMs) created = fmtTime(new Date(mtimeMs));
    if (!created) created = fmtTime(new Date());
    if (!updated) updated = created;

    let title = filename;
    body = body.trimStart();
    const heading = body.match(/^#\s+(.+)/m);
    if (heading) {
      title = stripMdText(heading[1]);
      body = body.slice(body.indexOf('\n', heading.index!) + 1).trimStart();
    }
    body = body.replace(/<!--\s*(?:created|updated):.+?-->\s*/g, '').trim();

    setFrontmatter(parsedFrontmatter);
    setDisplayTitle(title);
    titleRef.current = title;
    setContent(body);
    contentRef.current = body;
    setCreatedAt(created);
    setUpdatedAt(updated);
    createdAtRef.current = created;
    updatedAtRef.current = updated;
    resetSave();
  }, [filename, loadedDocument, resetSave]);

  const handleTitleChange = useCallback((val: string) => {
    setDisplayTitle(val);
    titleRef.current = val;
    scheduleSave();
  }, [scheduleSave]);

  const handleChange = useCallback((md: string) => {
    contentRef.current = md;
    scheduleSave();
  }, [scheduleSave]);

  // wiki 链接跳转：useLayoutEffect 在绘制前发起定位，rAF 轮询直到 Tiptap 标题渲染完成
  useLayoutEffect(() => {
    if (!pendingAnchor || loading) return;
    const cancel = scrollToAnchorPathPolling(pendingAnchor, () => onAnchorDone?.());
    return cancel;
  }, [pendingAnchor, loading]);

  // 拉取反向引用
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/backlinks?kind=project&category=${encodeURIComponent(subdir)}&filename=${encodeURIComponent(filename)}`);
        const json = await res.json();
        if (json.success) setBacklinks(json.data || []);
      } catch {}
    })();
  }, [subdir, filename]);

  const backlinkMap = useMemo(() => {
    const map: Record<string, BacklinkEntry[]> = {};
    for (const bl of backlinks) {
      const path = bl.resolved?.resolvedPath || [];
      if (path.length === 0) continue;
      const key = stripMdText(path[path.length - 1]);
      if (!key) continue;
      (map[key] ||= []).push({
        sourceDocKey: bl.sourceFilename.replace(/\.md$/, ''),
        sourceTitle: bl.sourceTitle,
        contextAnchor: bl.contextAnchor || [],
      });
    }
    return map;
  }, [backlinks]);

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
            {frontmatter.status && (
              <span style={{ fontSize: 12, background: '#e7f5ff', color: '#1971c2', padding: '2px 8px', borderRadius: 3 }}>
                {frontmatter.status}
              </span>
            )}
            <span style={{ fontSize: 12, color: '#999' }}>创建：{createdAt}</span>
            <span style={{ fontSize: 12, color: '#999' }}>修改：{updatedAt}</span>
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

      {loading ? (
        <div className="loading-overlay"><div className="loading-spinner" /></div>
      ) : (
        <WysiwygEditor
          key={`${subdir}/${filename}`}
          initialMarkdown={content}
          onChange={handleChange}
          documentTitle={displayTitle}
          sectionName={displayTitle}
          backlinkMap={backlinkMap}
          imageBase={imageBase}
          uploadDir={uploadDir}
          docKey={filename ? filename.replace(/\.md$/, '') : ''}
        />
      )}

      <BacklinksPanel backlinks={backlinks} />
    </div>
  );
}
