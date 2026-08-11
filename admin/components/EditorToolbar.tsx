'use client';

import { useEffect, useState } from 'react';
import { getActiveEditor, onChange as onEditorChange } from '@/lib/activeEditor';

const FONT_COLORS = [
  { v: '#e03131', t: '红', k: 'R' },
  { v: '#2f9e44', t: '绿', k: 'G' },
  { v: '#4c6ef5', t: '蓝', k: 'B' },
  { v: '#f08c00', t: '橙', k: 'O' },
  { v: '#7950f2', t: '紫', k: 'P' },
];

const BG_COLORS = [
  { v: '#fff3cd', t: '黄', k: 'Y' },
  { v: '#d3f9d8', t: '绿', k: 'G' },
  { v: '#d0ebff', t: '蓝', k: 'B' },
  { v: '#ffe3e3', t: '红', k: 'R' },
];

const FONT_SIZES = [
  { v: '0.85em', t: '小' },
  { v: '1em', t: '常' },
  { v: '1.15em', t: '中' },
  { v: '1.3em', t: '大' },
  { v: '1.5em', t: '特大' },
];

export default function EditorToolbar() {
  const [, setTick] = useState(0);

  // Re-render when active editor changes
  useEffect(() => onEditorChange(() => setTick((t) => t + 1)), []);

  const editor = getActiveEditor();

  // Re-render when selection changes in the active editor
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick((t) => t + 1);
    editor.on('selectionUpdate', handler);
    return () => { editor.off('selectionUpdate', handler); };
  }, [editor]);
  const activeFontSize = editor?.getAttributes('textStyle').fontSize || '';

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      const ed = getActiveEditor();
      if (!ed || ed.isDestroyed) return;
      const key = (ke.key || '').toLowerCase();
      const ctrl = ke.ctrlKey || ke.metaKey;

      // Ctrl+E → inline code
      if (ctrl && !ke.altKey && !ke.shiftKey && key === 'e') {
        ke.preventDefault();
        ed.chain().focus().toggleCode().run();
        return;
      }
      // Ctrl+S → strikethrough
      if (ctrl && !ke.altKey && !ke.shiftKey && key === 's') {
        ke.preventDefault();
        ed.chain().focus().toggleStrike().run();
        return;
      }
      // Alt+L → code block
      if (ke.altKey && !ctrl && !ke.shiftKey && key === 'l') {
        ke.preventDefault();
        ed.chain().focus().toggleCodeBlock().run();
        return;
      }

      const letter = key.toUpperCase();

      // Alt+letter → background color
      if (ke.altKey && !ctrl) {
        const bg = BG_COLORS.find(c => c.k === letter);
        if (bg) {
          ke.preventDefault();
          if (ed.isActive('textStyle', { backgroundColor: bg.v })) {
            ed.chain().focus().unsetBackgroundColor().run();
          } else {
            ed.chain().focus().setBackgroundColor(bg.v).run();
          }
          return;
        }
      }

      // Ctrl+Alt+letter → font color
      if (ctrl && ke.altKey) {
        const fc = FONT_COLORS.find(c => c.k === letter);
        if (fc) {
          ke.preventDefault();
          ed.isActive('textStyle', { color: fc.v }) ? ed.chain().focus().unsetColor().run() : ed.chain().focus().setColor(fc.v).run();
          return;
        }
      }
    };

    // Attach to document with capture phase to beat browser shortcuts
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  return (
    <>
      <div className={`global-toolbar${editor ? '' : ' disabled'}`}>
        <ToolBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} label={<strong>B</strong>} title="加粗 (Ctrl+B)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} label={<em>I</em>} title="斜体 (Ctrl+I)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive('underline')} label={<u>U</u>} title="下划线 (Ctrl+U)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive('strike')} label={<s>S</s>} title="删除线 (Ctrl+S)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive('code')} label="&lt;&gt;" title="行内代码 (Ctrl+E)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleHighlight().run()} active={editor?.isActive('highlight')} label="H" title="高亮" hl />

        <ToolSep />

        <ToolBtn onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive('heading', { level: 1 })} label="H1" title="标题1" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive('heading', { level: 2 })} label="H2" title="标题2" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={editor?.isActive('heading', { level: 3 })} label="H3" title="标题3" />
        <ToolBtn onClick={() => editor?.chain().focus().setParagraph().run()} active={editor?.isActive('paragraph')} label="P" title="正文" />

        <ToolSep />

        <ToolBtn onClick={() => editor?.chain().focus().toggleCodeBlock().run()} active={editor?.isActive('codeBlock')} label="&lt;/&gt;" title="代码块 (Alt+L)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} label="❝" title="引用" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} label="•" title="无序列表" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} label="1." title="有序列表" />
        <ToolBtn onClick={() => editor?.chain().focus().setHorizontalRule().run()} label="—" title="分割线" />

        <ToolSep />

        {FONT_COLORS.map(c => (
          <ToolBtn key={c.v}
            onClick={() => editor?.isActive('textStyle', { color: c.v }) ? editor?.chain().focus().unsetColor().run() : editor?.chain().focus().setColor(c.v).run()}
            active={editor?.isActive('textStyle', { color: c.v })}
            title={`字体颜色: ${c.t} (Ctrl+Alt+${c.k})`}
            label={<span style={{ color: c.v, fontWeight: 700, fontSize: 13 }}>A</span>} />
        ))}

        <ToolSep />

        {BG_COLORS.map(c => (
          <ToolBtn key={c.v}
            onClick={() => editor?.isActive('textStyle', { backgroundColor: c.v }) ? editor?.chain().focus().unsetBackgroundColor().run() : editor?.chain().focus().setBackgroundColor(c.v).run()}
            active={editor?.isActive('textStyle', { backgroundColor: c.v })}
            title={`背景色: ${c.t} (Alt+${c.k})`}
            label={<span className="toolbar-color-swatch" style={{ background: c.v }} aria-hidden="true" />} />
        ))}

        <ToolSep />

        <select
          className="toolbar-font-size-select"
          value={activeFontSize}
          onChange={event => editor?.chain().focus().setFontSize(event.target.value).run()}
          aria-label="字号"
          title="调整字号"
        >
          <option value="">字号</option>
          {FONT_SIZES.map(size => (
            <option key={size.v} value={size.v}>{size.t === '常' ? '常规' : size.t}</option>
          ))}
        </select>

        <ToolSep />

        <ToolBtn onClick={() => editor?.chain().focus().undo().run()} label="↩" title="撤销 (Ctrl+Z)" />
        <ToolBtn onClick={() => editor?.chain().focus().redo().run()} label="↪" title="重做 (Ctrl+Shift+Z)" />

      </div>

    </>
  );
}

function ToolBtn({ onClick, active, label, title, wide, hl }: {
  onClick: () => void; active?: boolean; label: React.ReactNode; title?: string; wide?: boolean; hl?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={`toolbar-btn${active ? ' active' : ''}`} title={title} aria-label={title}
      style={{ ...(wide ? { width: 'auto', padding: '0 8px', fontSize: 12 } : {}), ...(hl && active ? { background: '#fff3cd' } : {}) }}>
      {label}
    </button>
  );
}

function ToolSep() {
  return <div style={{ width: 1, height: 20, background: '#d0d0d0', margin: '0 4px' }} />;
}
