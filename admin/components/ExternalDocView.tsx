'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import WysiwygEditor from './WysiwygEditor';
import TocPanel from './TocPanel';
import { stripMdText } from '@/lib/stripText';

const AUTO_SAVE_DELAY = 400;

interface TocHeading { label: string; level: number; }

function parseHeadings(md: string): TocHeading[] {
  const headings: TocHeading[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) {
      headings.push({ level: m[1].length, label: stripMdText(m[2]) });
    }
  }
  return headings;
}

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
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [displayTitle, setDisplayTitle] = useState('');
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting'>('saved');
  const [showToc, setShowToc] = useState(true);
  const contentRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef('');
  const doSaveRef = useRef<(md: string) => void>(() => {});
  const mountedRef = useRef(true);

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);

  const headings = parseHeadings(contentRef.current);

  useEffect(() => {
    setLoading(true);
    setMissing(false);
    setPath('');
    setContent('');
    contentRef.current = '';
    setDisplayTitle('');
    titleRef.current = '';
    setFrontmatter({});
    setMtimeMs(null);
    setSaveStatus('saved');
    (async () => {
      try {
        const res = await fetch(`/api/external/${encodeURIComponent(id)}`);
        const json = await res.json();
        if (res.ok && json.success) {
          const raw = json.data as string;
          let fm: Record<string, string> = {};
          let body = raw;

          // 剥离 frontmatter（保存时原样保留）
          if (raw.startsWith('---')) {
            const end = raw.indexOf('---', 3);
            if (end > 0) {
              const fmText = raw.slice(3, end).trim();
              for (const line of fmText.split('\n')) {
                const colon = line.indexOf(':');
                if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
              }
              body = raw.slice(end + 3).trimStart();
            }
          }

          // 剥离 H1 作为标题，编辑器内容不包含 H1
          let title = basename(json.path);
          body = body.trimStart();
          const h1Match = body.match(/^#\s+(.+)/m);
          if (h1Match) {
            // 标题可能带颜色等内联 HTML（<span style>），显示前统一剥成纯文本
            title = stripMdText(h1Match[1]);
            body = body.slice(body.indexOf('\n', h1Match.index!) + 1).trimStart();
          }

          setFrontmatter(fm);
          setDisplayTitle(title);
          titleRef.current = title;
          setContent(body);
          contentRef.current = body;
          setPath(json.path);
          setMtimeMs(json.mtimeMs ?? null);
        } else {
          setMissing(true);
          setPath(json.path || '');
        }
      } catch {
        setMissing(true);
      }
      setLoading(false);
    })();
  }, [id]);

  const handleTitleChange = useCallback((val: string) => {
    setDisplayTitle(val);
    titleRef.current = val;
    setSaveStatus('waiting');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSaveRef.current(contentRef.current);
    }, AUTO_SAVE_DELAY);
  }, []);

  const doSave = useCallback(async (md: string) => {
    if (!mountedRef.current) return;
    setSaveStatus('saving');

    // 外部文档写回：H1 + 正文 + 原样保留的 frontmatter，不注入任何时间注释
    const body = `# ${titleRef.current}\n\n${md}`;
    const fmLines = Object.entries(frontmatter)
      .filter(([k, v]) => k !== 'title' && v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const full = fmLines ? `---\n${fmLines}\n---\n\n${body}` : body;
    try {
      const res = await fetch(`/api/external/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: full }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setSaveStatus('saved');
        setMtimeMs(Date.now());
        onSaved?.();
      } else if (json.path) {
        setMissing(true);
        setPath(json.path);
      } else {
        setSaveStatus('waiting');
      }
    } catch {
      setSaveStatus('waiting');
    }
  }, [id, frontmatter, onSaved]);

  doSaveRef.current = doSave;

  const handleChange = useCallback((md: string) => {
    contentRef.current = md;
    setSaveStatus('waiting');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSaveRef.current(contentRef.current);
    }, AUTO_SAVE_DELAY);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id]);

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
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#999', wordBreak: 'break-all' }}>{path}</span>
            {mtimeMs != null && (
              <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>修改：{fmtTime(mtimeMs)}</span>
            )}
          </div>
        </div>
      </div>

      {headings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            className="btn btn-small btn-secondary"
            onClick={() => setShowToc(!showToc)}
            style={{ marginBottom: showToc ? 8 : 0 }}
          >
            {showToc ? '隐藏目录' : '目录'}
          </button>
          {showToc && <TocPanel headings={headings} sections={[]} />}
        </div>
      )}

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
