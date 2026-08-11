'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import WysiwygEditor from './WysiwygEditor';
import TocPanel from './TocPanel';

const AUTO_SAVE_DELAY = 400;

interface TocHeading { label: string; level: number; }

function parseHeadings(md: string): TocHeading[] {
  const headings: TocHeading[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) headings.push({ level: m[1].length, label: m[2].trim() });
  }
  return headings;
}

function fmtTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  subdir: string;
  filename: string;
  onBack: () => void;
  onSaved?: () => void;
}

export default function ProjectDocumentView({ subdir, filename, onBack, onSaved }: Props) {
  const [content, setContent] = useState('');
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [displayTitle, setDisplayTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting'>('saved');
  const [showToc, setShowToc] = useState(true);
  const [createdAt, setCreatedAt] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const contentRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef('');
  const doSaveRef = useRef<(md: string) => void>(() => {});
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');

  const headings = useMemo(() => parseHeadings(contentRef.current), [content]);

  useEffect(() => {
    setDisplayTitle('');
    setContent('');
    contentRef.current = '';
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/project/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`);
        const json = await res.json();
        if (json.success) {
          const raw = json.data as string;
          const mtimeMs = json.mtimeMs as number | null;
          let fm: Record<string, string> = {};
          let body = raw;
          let created = '';
          let updated = '';

          // 解析已有时间元数据
          const crMatch = raw.match(/<!--\s*created:\s*(.+?)\s*-->/);
          const upMatch = raw.match(/<!--\s*updated:\s*(.+?)\s*-->/);
          if (crMatch) created = crMatch[1].trim();
          if (upMatch) updated = upMatch[1].trim();

          // 剥离 frontmatter
          if (raw.startsWith('---')) {
            const end = raw.indexOf('---', 3);
            if (end > 0) {
              const fmText = raw.slice(3, end).trim();
              for (const line of fmText.split('\n')) {
                const colon = line.indexOf(':');
                if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
              }
              body = raw.slice(end + 3).trimStart();
              // frontmatter 中的 created 优先级低于 HTML 注释
              if (!created && fm.created) created = fm.created;
            }
          }

          // 若无 created，根据文件修改时间生成默认创建时间
          if (!created && mtimeMs) {
            created = fmtTime(new Date(mtimeMs));
          }
          if (!created) created = fmtTime(new Date());
          if (!updated) updated = created;

          // 剥离 H1 作为标题，编辑器内容不包含 H1
          let title = filename;
          body = body.trimStart();
          const h1Match = body.match(/^#\s+(.+)/m);
          if (h1Match) {
            title = h1Match[1].trim();
            body = body.slice(body.indexOf('\n', h1Match.index!) + 1).trimStart();
          }

          // 剥离已有的时间注释（避免编辑器内显示）
          body = body.replace(/<!--\s*(?:created|updated):.+?-->\s*/g, '').trim();

          setFrontmatter(fm);
          setDisplayTitle(title);
          titleRef.current = title;
          setContent(body);
          contentRef.current = body;
          setCreatedAt(created);
          setUpdatedAt(updated);
          createdAtRef.current = created;
          updatedAtRef.current = updated;
        }
      } catch {}
      setLoading(false);
    })();
  }, [subdir, filename]);

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
    setSaveStatus('saving');
    const now = fmtTime(new Date());
    updatedAtRef.current = now;
    setUpdatedAt(now);

    const body = `# ${titleRef.current}\n\n${md}\n\n<!-- created: ${createdAtRef.current} -->\n<!-- updated: ${now} -->`;
    const fmLines = Object.entries(frontmatter)
      .filter(([k, v]) => k !== 'title' && k !== 'created' && k !== 'updated' && v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const full = fmLines ? `---\n${fmLines}\n---\n\n${body}` : body;
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: full }),
      });
      if (res.ok) { setSaveStatus('saved'); onSaved?.(); }
      else setSaveStatus('saved');
    } catch {
      setSaveStatus('saved');
    }
  }, [subdir, filename, frontmatter]);

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
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [subdir, filename]);

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
            {frontmatter.status && (
              <span style={{ fontSize: 12, background: '#e7f5ff', color: '#1971c2', padding: '2px 8px', borderRadius: 3 }}>
                {frontmatter.status}
              </span>
            )}
            <span style={{ fontSize: 12, color: '#999' }}>创建：{createdAt}</span>
            <span style={{ fontSize: 12, color: '#999' }}>修改：{updatedAt}</span>
            <div className="doc-save-status" data-status={saveStatus} style={{ marginLeft: 'auto' }}>
              {saveStatus === 'saving' && '保存中...'}
              {saveStatus === 'waiting' && '待保存'}
              {saveStatus === 'saved' && '已保存'}
            </div>
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

      {loading ? (
        <div className="loading-overlay"><div className="loading-spinner" /></div>
      ) : (
        <WysiwygEditor
          key={`${subdir}/${filename}`}
          initialMarkdown={content}
          onChange={handleChange}
          documentTitle={displayTitle}
          sectionName={displayTitle}
        />
      )}
    </div>
  );
}
