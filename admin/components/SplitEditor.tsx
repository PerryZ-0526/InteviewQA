'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { EDITOR_COLORS, EDITOR_COLOR_DEFAULT } from '@/lib/editorColors';

interface Props {
  initialContent: string;
  onSave: (content: string) => void | Promise<void>;
  filename?: string; // for display
  autoSaveDelay?: number; // 毫秒，设置后内容变化自动保存
  onSaveStatusChange?: (status: 'saved' | 'saving' | 'waiting') => void;
}

export default function SplitEditor({ initialContent, onSave, filename, autoSaveDelay, onSaveStatusChange }: Props) {
  const [content, setContent] = useState(initialContent);
  const [readOnly, setReadOnly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting'>('saved');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  // Sync scroll: when textarea scrolls, preview follows
  const [editorScrollRatio, setEditorScrollRatio] = useState(0);

  useEffect(() => {
    setContent(initialContent);
    setSaveStatus('saved');
    setReadOnly(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [initialContent]);

  const performSave = useCallback(async (value: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveStatus('saving');
    try {
      await onSave(value);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('waiting');
    } finally {
      savingRef.current = false;
    }
  }, [onSave]);

  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  // Ctrl+S 立即保存；设置了 autoSaveDelay 时变化后自动保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (timerRef.current) clearTimeout(timerRef.current);
        performSave(content);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, performSave]);

  // Mark as unsaved on change（可选自动保存）
  const handleChange = useCallback((value: string) => {
    setContent(value);
    setSaveStatus('waiting');
    if (autoSaveDelay != null) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => performSave(value), autoSaveDelay);
    }
  }, [autoSaveDelay, performSave]);

  // Insert mark at cursor
  const insertMark = (before: string, after: string = '') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);
    const newText = content.substring(0, start) + before + selected + after + content.substring(end);
    handleChange(newText);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 0);
  };

  // Scroll sync
  const handleEditorScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const ratio = ta.scrollTop / (ta.scrollHeight - ta.clientHeight);
    setEditorScrollRatio(ratio || 0);
  };

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !readOnly) return;
    preview.scrollTop = editorScrollRatio * (preview.scrollHeight - preview.clientHeight);
  }, [editorScrollRatio, readOnly]);

  // Read-only view — full width markdown preview
  if (readOnly) {
    return (
      <div>
        {/* Header toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#f8f9fa',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius) var(--radius) 0 0',
          borderBottom: 'none',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            阅读模式
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {saveStatus !== 'saved' && <span style={{ fontSize: 11, color: '#f08c00' }}>未保存</span>}
            <button className="btn btn-small btn-primary" onClick={() => setReadOnly(false)}>
              编辑
            </button>
          </div>
        </div>

        <div
          ref={previewRef}
          className="markdown-preview"
          style={{
            padding: 24,
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 var(--radius) var(--radius)',
            minHeight: 'calc(100vh - 220px)',
            background: '#fff',
            overflowY: 'auto',
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !String(children).includes('\n');
                if (isInline) return <code {...props}>{children}</code>;
                return (
                  <pre>
                    <code className={className} {...props}>{children}</code>
                  </pre>
                );
              },
              a({ href, children, ...props }: any) {
                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
              },
              mark({ children, ...props }: any) {
                return <mark {...props}>{children}</mark>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // Edit mode — split pane
  return (
    <div>
      {/* Toolbar */}
      <div className="toolbar">
        <button onClick={() => insertMark('**', '**')} title="加粗"><strong>B</strong></button>
        <button onClick={() => insertMark('*', '*')} title="斜体"><em>I</em></button>
        <button onClick={() => insertMark('<u>', '</u>')} title="下划线"><span style={{ textDecoration: 'underline' }}>U</span></button>
        <button onClick={() => insertMark('~~', '~~')} title="删除线"><span style={{ textDecoration: 'line-through' }}>S</span></button>

        <span className="separator" />

        <button onClick={() => insertMark('# ', '')} title="一级标题">H1</button>
        <button onClick={() => insertMark('## ', '')} title="二级标题">H2</button>
        <button onClick={() => insertMark('### ', '')} title="三级标题">H3</button>

        <span className="separator" />

        <button onClick={() => insertMark('```\n', '\n```')} title="代码块">&lt;/&gt;</button>
        <button onClick={() => insertMark('`', '`')} title="行内代码">`</button>
        <button onClick={() => insertMark('> ', '')} title="引用">"</button>

        <span className="separator" />

        <button onClick={() => insertMark('- ', '')} title="无序列表">-</button>
        <button onClick={() => insertMark('1. ', '')} title="有序列表">1.</button>
        <button onClick={() => insertMark('[', '](url)')} title="链接">🔗</button>

        <span className="separator" />

        <button onClick={() => insertMark('==', '==')} title="高亮" style={{ background: '#fff3cd' }}>= =</button>

        <span className="separator" />

        {/* 字体颜色：与主编辑器共用统一色板（黑色为默认态，纯文本插入无意义，故排除） */}
        {EDITOR_COLORS.filter(c => c.v !== EDITOR_COLOR_DEFAULT).map(c => (
          <button key={c.v} onClick={() => insertMark(`<span style="color: ${c.v}">`, '</span>')} title={c.t} style={{ color: c.v, fontWeight: 'bold' }}>A</button>
        ))}

        <select
          onChange={(e) => {
            if (e.target.value) insertMark(`<span style="font-size: ${e.target.value}">`, '</span>');
            e.target.value = '';
          }}
          title="字号"
        >
          <option value="">字号</option>
          <option value="0.8em">小</option>
          <option value="1em">正常</option>
          <option value="1.2em">大</option>
          <option value="1.5em">特大</option>
        </select>

        <select
          onChange={(e) => {
            if (e.target.value) insertMark(`<span style="background: ${e.target.value}">`, '</span>');
            e.target.value = '';
          }}
          title="背景色"
        >
          <option value="">背景色</option>
          <option value="#fff3cd">黄色</option>
          <option value="#d3f9d8">绿色</option>
          <option value="#d0ebff">蓝色</option>
          <option value="#ffe3e3">红色</option>
        </select>

        {/* Right side controls */}
        <div style={{ flex: 1 }} />
        {saveStatus === 'waiting' && <span style={{ fontSize: 11, color: '#f08c00', marginRight: 8 }}>未保存</span>}
        <button
          onClick={() => performSave(content)}
          disabled={saveStatus === 'saving'}
          style={{
            ...toolbarBtnStyle,
            background: saveStatus === 'saved' ? 'transparent' : '#4c6ef5',
            color: saveStatus === 'saved' ? 'inherit' : '#fff',
            width: 'auto',
            padding: '0 8px',
            fontSize: 11,
          }}
          title="保存 (Ctrl+S)"
        >
          {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '保存'}
        </button>
        <button
          onClick={() => setReadOnly(true)}
          style={{ ...toolbarBtnStyle, width: 'auto', padding: '0 8px', fontSize: 11 }}
          title="切换到阅读模式"
        >
          阅读
        </button>
      </div>

      {/* Split pane */}
      <div style={{ display: 'flex', height: 'calc(100vh - 220px)', border: '1px solid var(--border)', borderTop: 'none' }}>
        {/* Left: Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <textarea
            ref={textareaRef}
            style={{
              flex: 1,
              padding: 16,
              border: 'none',
              borderRight: '1px solid var(--border)',
              outline: 'none',
              resize: 'none',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.7,
              background: '#fafafa',
            }}
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onScroll={handleEditorScroll}
            placeholder="开始编辑..."
            spellCheck={false}
          />
        </div>

        {/* Right: Live Preview */}
        <div
          ref={previewRef}
          className="markdown-preview"
          style={{
            flex: 1,
            padding: 16,
            overflowY: 'auto',
            background: '#fff',
          }}
          onScroll={(e) => {
            // Could sync back to editor if desired
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !String(children).includes('\n');
                if (isInline) return <code {...props}>{children}</code>;
                return (
                  <pre>
                    <code className={className} {...props}>{children}</code>
                  </pre>
                );
              },
              a({ href, children, ...props }: any) {
                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
              },
              mark({ children, ...props }: any) {
                return <mark {...props}>{children}</mark>;
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        padding: '4px 16px',
        fontSize: 11,
        color: 'var(--text-secondary)',
        display: 'flex',
        gap: 16,
        background: '#f8f9fa',
        border: '1px solid var(--border)',
        borderTop: 'none',
        borderRadius: '0 0 var(--radius) var(--radius)',
      }}>
        <span>编辑模式</span>
        <span>{autoSaveDelay != null ? '自动保存' : 'Ctrl+S 保存'}</span>
        <span>{content.length} 字符</span>
        {filename && <span>{filename}</span>}
      </div>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 13,
  color: '#333',
};
