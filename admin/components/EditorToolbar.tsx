'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { getActiveEditor, getActiveUploadDir, onChange as onEditorChange } from '@/lib/activeEditor';
import {
  EDITOR_COLOR_DEFAULT,
  EDITOR_COLORS,
  getEditorColor,
  setEditorColor,
  toColorAttr,
} from '@/lib/editorColors';
import { CODE_THEMES, getCodeTheme, setCodeTheme, initCodeTheme } from '@/lib/codeThemes';

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

const TRAILING_PUNCTUATION = /[：、，？。！]+$/;

// 将光标所在行转为指定级别标题，并去掉行末标点（：、，？。！），保留行内样式标记
function applyHeadingLevel(ed: Editor, level: 1 | 2 | 3 | 4) {
  const { $from } = ed.state.selection;
  // 光标在文本内部时 $from.parent 是文本节点，需要向上找到 paragraph/heading 块
  let depth = 0;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'paragraph' || name === 'heading') {
      depth = d;
      break;
    }
  }
  if (!depth) return;

  const block = $from.node(depth);
  let content = block.content;
  const last = content.lastChild;
  if (last && last.isText) {
    const text = last.text || '';
    const cleaned = text.replace(TRAILING_PUNCTUATION, '');
    if (cleaned !== text) {
      content = cleaned
        ? content.replaceChild(content.childCount - 1, ed.state.schema.text(cleaned, last.marks))
        : content.cut(0, content.size - last.nodeSize);
    }
  }

  const heading = ed.state.schema.nodes.heading.create({ level }, content);
  ed.view.dispatch(
    ed.state.tr.replaceWith($from.before(depth), $from.before(depth) + block.nodeSize, heading).scrollIntoView(),
  );
  ed.view.focus();
}

// 工具栏按钮：已是该级别标题则切回正文，否则转为标题（含行末标点清理）
function headingButtonAction(ed: Editor, level: 1 | 2 | 3 | 4) {
  if (ed.isActive('heading', { level })) {
    ed.chain().focus().toggleHeading({ level }).run();
  } else {
    applyHeadingLevel(ed, level);
  }
}

// ---- 标题颜色：作用于光标所在的整个标题块（textStyle 颜色标记）----
// 序列化为 `## <span style="color: ...">标题</span>`，与既有彩色标题文档格式一致

/** 光标所在标题块的内容范围；不在标题内返回 null */
function headingBlockAt(ed: Editor): { from: number; to: number } | null {
  const { $from } = ed.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'heading') {
      return { from: $from.start(d), to: $from.end(d) };
    }
  }
  return null;
}

/** 标题块内首个已着色文本的颜色（null = 未着色/默认） */
function headingCurrentColor(ed: Editor): string | null {
  const block = headingBlockAt(ed);
  if (!block) return null;
  let color: string | null = null;
  ed.state.doc.nodesBetween(block.from, block.to, (node) => {
    if (color || !node.isText) return;
    const c = node.marks.find(m => m.type.name === 'textStyle')?.attrs?.color;
    if (c) color = c;
  });
  return color;
}

/** 标题块文本是否整体为指定颜色 */
function headingFullyColored(ed: Editor, color: string): boolean {
  const block = headingBlockAt(ed);
  if (!block || block.from === block.to) return false;
  let sawText = false;
  let ok = true;
  ed.state.doc.nodesBetween(block.from, block.to, (node) => {
    if (!node.isText) return;
    sawText = true;
    if (node.marks.find(m => m.type.name === 'textStyle')?.attrs?.color !== color) ok = false;
  });
  return sawText && ok;
}

/** 对整个标题块应用/清除颜色；保留字号、背景色等其他 textStyle 属性，不移动光标 */
function setHeadingBlockColor(ed: Editor, color: string | null) {
  const block = headingBlockAt(ed);
  if (!block || block.from === block.to) return;
  const { state } = ed;
  const markType = state.schema.marks.textStyle;
  if (!markType) return;

  // 先收集文本段与既有属性，再统一改写（addMark/removeMark 不改文档结构，坐标稳定）
  const ranges: { from: number; to: number; attrs: Record<string, unknown> }[] = [];
  state.doc.nodesBetween(block.from, block.to, (node, pos) => {
    if (!node.isText) return;
    const existing = node.marks.find(m => m.type === markType);
    ranges.push({
      from: Math.max(pos, block.from),
      to: Math.min(pos + node.nodeSize, block.to),
      attrs: existing ? { ...existing.attrs } : {},
    });
  });

  const tr = state.tr;
  for (const r of ranges) {
    tr.removeMark(r.from, r.to, markType);
    if (color) r.attrs.color = color;
    else delete r.attrs.color;
    if (Object.values(r.attrs).some(v => v != null)) {
      tr.addMark(r.from, r.to, markType.create(r.attrs));
    }
  }
  ed.view.dispatch(tr.scrollIntoView());
  ed.view.focus();
}

/**
 * 通用拆分按钮：主按钮 + caret 弹层（fixed + portal，规避工具栏 overflow 裁剪）。
 * 下划线/字体/标题颜色、代码块主题等所有「主操作 + 选项弹层」控件共用，
 * 弹层内容由 children(close) 渲染，选中后调用 close() 收起。
 */
function SplitButton({ main, active, title, popTitle, onMain, children }: {
  main: React.ReactNode;
  active?: boolean;
  title: string;
  popTitle: string;
  onMain: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const openPop = () => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
      top: rect.bottom + 6,
    });
    setOpen(true);
  };

  // 关闭弹层：点击外部 / Esc / 页面或工具栏滚动（fixed 定位会失位）/ 窗口尺寸变化
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="tb-ul-wrap" ref={wrapRef}>
      <button
        type="button"
        onClick={onMain}
        className={`toolbar-btn tb-ul-main${active ? ' active' : ''}`}
        title={title}
        aria-label={title}
      >
        {main}
      </button>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPop())}
        className="toolbar-btn tb-ul-caret"
        title={popTitle}
        aria-label={popTitle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
          <path d="M1 2.2L3.5 4.8L6 2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div className="tb-ul-pop" ref={popRef} role="menu" aria-label={popTitle} style={{ left: pos.left, top: pos.top }}>
          <div className="tb-ul-pop-title">{popTitle}</div>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * 颜色拆分按钮：主按钮（字形 + 色条）+ caret 弹层选色。
 * 字体颜色 / 标题颜色 / 下划线颜色三个控件共用，弹层选项统一来自 EDITOR_COLORS。
 */
function ColorSplitButton({ glyph, barColor, active, title, popTitle, current, onMain, onPick }: {
  glyph: string;
  barColor: string;
  active?: boolean;
  title: string;
  popTitle: string;
  current: string;
  onMain: () => void;
  onPick: (value: string) => void;
}) {
  return (
    <SplitButton
      main={
        <>
          <span className="tb-ul-glyph">{glyph}</span>
          <span className="tb-ul-bar" style={{ background: barColor }} aria-hidden="true" />
        </>
      }
      active={active}
      title={title}
      popTitle={popTitle}
      onMain={onMain}
    >
      {(close) => (
        <div className="tb-ul-pop-grid">
          {EDITOR_COLORS.map(c => (
            <button
              type="button"
              key={c.v}
              role="menuitemradio"
              aria-checked={current === c.v}
              className={`tb-ul-swatch${current === c.v ? ' current' : ''}`}
              title={`${popTitle}：${c.t}`}
              onClick={() => { close(); onPick(c.v); }}
            >
              <span className="tb-ul-dot" style={{ background: c.v }} aria-hidden="true" />
              <span className="tb-ul-name">{c.t}</span>
            </button>
          ))}
        </div>
      )}
    </SplitButton>
  );
}

export default function EditorToolbar() {
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-render when active editor changes
  useEffect(() => onEditorChange(() => setTick((t) => t + 1)), []);

  const editor = getActiveEditor();

  // Re-render when selection or doc state changes in the active editor
  // （transaction：应用颜色等不改光标的操作后，色条状态也要刷新）
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick((t) => t + 1);
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);
  const activeFontSize = editor?.getAttributes('textStyle').fontSize || '';

  // ---- 三种颜色选择（色板统一来自 lib/editorColors，各自持久化到 localStorage）----
  const [fontColor, setFontColor] = useState<string>(() => getEditorColor('font'));
  const [headingColor, setHeadingColor] = useState<string>(() => getEditorColor('heading'));
  const [ulColor, setUlColor] = useState<string>(() => getEditorColor('underline'));

  // ---- 代码块配色主题（持久化；CSS 通过 data-code-theme 切换，layout 已防首屏闪烁）----
  const [codeTheme, setCodeThemeState] = useState<string>(() => getCodeTheme());
  useEffect(() => { initCodeTheme(); }, []);

  const handleImageFile = async (file: File) => {
    const ed = getActiveEditor();
    const dir = getActiveUploadDir();
    if (!ed || ed.isDestroyed) return;
    if (!dir) {
      alert('当前编辑器不支持插入图片');
      return;
    }
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dir', dir);
      const res = await fetch('/api/upload-image', { method: 'POST', body: form });
      const json = await res.json();
      if (json.success && json.src) {
        ed.chain().focus().insertContent({ type: 'image', attrs: { src: json.src, alt: '' } }).run();
      } else {
        alert(json.error || '图片上传失败');
      }
    } catch {
      alert('图片上传失败');
    }
  };

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
      // Ctrl+1~4 / Ctrl+Alt+1~4 → 当前行转对应级别标题，去掉行末标点（：、，？。！）。
      // Chrome/Edge 将 Ctrl+数字 保留为切换标签页，事件不会送达页面，
      // 故提供 Ctrl+Alt+数字 这一全浏览器可用的组合，Ctrl+数字 作为兼容分支保留
      if (ctrl && !ke.shiftKey && ['1', '2', '3', '4'].includes(key)) {
        ke.preventDefault();
        applyHeadingLevel(ed, parseInt(key, 10) as 1 | 2 | 3 | 4);
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

      // Ctrl+Alt+letter → font color（统一色板，快捷键随色板定义）
      if (ctrl && ke.altKey) {
        const fc = EDITOR_COLORS.find(c => c.k === letter);
        if (fc) {
          ke.preventDefault();
          if (ed.isActive('textStyle', { color: fc.v })) {
            ed.chain().focus().unsetColor().run();
          } else {
            ed.chain().focus().setColor(fc.v).run();
            // 快捷键选中某颜色同样视为颜色选择，持久化为下次默认
            setEditorColor('font', fc.v);
            setFontColor(fc.v);
          }
          return;
        }
      }
    };

    // Attach to document with capture phase to beat browser shortcuts
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // ---- 字体颜色 ----
  // 色条：选区内已有颜色时显示该颜色，否则显示下次将应用的颜色
  const fontSelColor = (editor?.getAttributes('textStyle').color as string | undefined) || '';
  const fontBarColor = fontSelColor || fontColor;

  const toggleFontColor = () => {
    if (!editor || editor.isDestroyed) return;
    // 黑色（默认）或选区已是该颜色 → 移除颜色；否则应用所选颜色
    if (fontColor === EDITOR_COLOR_DEFAULT || fontSelColor === fontColor) {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(fontColor).run();
    }
  };

  const pickFontColor = (value: string) => {
    setFontColor(value);
    setEditorColor('font', value);
    const ed = getActiveEditor();
    if (!ed || ed.isDestroyed) return;
    if (value === EDITOR_COLOR_DEFAULT) ed.chain().focus().unsetColor().run();
    else ed.chain().focus().setColor(value).run();
  };

  // ---- 标题颜色（整行标题应用/清除）----
  const headingBlock = editor && !editor.isDestroyed ? headingBlockAt(editor) : null;
  const headingCurColor = editor && headingBlock ? headingCurrentColor(editor) : null;
  const headingBarColor = headingBlock
    ? (headingCurColor || EDITOR_COLOR_DEFAULT)
    : headingColor;

  const toggleHeadingColor = () => {
    if (!editor || editor.isDestroyed || !headingBlock) return;
    const attr = toColorAttr(headingColor);
    // 整行已是所选颜色（或所选为黑色）→ 清除；否则整行应用
    if (attr && !headingFullyColored(editor, attr)) {
      setHeadingBlockColor(editor, attr);
    } else {
      setHeadingBlockColor(editor, null);
    }
  };

  const pickHeadingColor = (value: string) => {
    setHeadingColor(value);
    setEditorColor('heading', value);
    const ed = getActiveEditor();
    if (!ed || ed.isDestroyed) return;
    if (headingBlockAt(ed)) setHeadingBlockColor(ed, toColorAttr(value));
  };

  // ---- 下划线颜色 ----
  // 色条：光标处于下划线内时显示该下划线的实际颜色，否则显示下次将应用的颜色
  const underlineActive = !!editor?.isActive('underline');
  const ulBarColor = underlineActive
    ? (editor?.getAttributes('underline').color as string | undefined) || EDITOR_COLOR_DEFAULT
    : ulColor;

  const toggleUnderline = () => {
    editor?.chain().focus().toggleUnderlineColor(toColorAttr(ulColor)).run();
  };

  const pickUnderlineColor = (value: string) => {
    setUlColor(value);
    setEditorColor('underline', value);
    editor?.chain().focus().setUnderlineColor(toColorAttr(value)).run();
  };

  return (
    <>
      <div className={`global-toolbar${editor ? '' : ' disabled'}`}>
        <ToolBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} label={<strong>B</strong>} title="加粗 (Ctrl+B)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} label={<em>I</em>} title="斜体 (Ctrl+I)" />
        <ColorSplitButton
          glyph="U"
          barColor={ulBarColor}
          active={underlineActive}
          title="下划线 (Ctrl+U)"
          popTitle="下划线颜色"
          current={ulColor}
          onMain={toggleUnderline}
          onPick={pickUnderlineColor}
        />
        <ToolBtn onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive('strike')} label={<s>S</s>} title="删除线 (Ctrl+S)" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive('code')} label="&lt;&gt;" title="行内代码 (Ctrl+E)" />

        <ToolSep />

        <ToolBtn onClick={() => editor && headingButtonAction(editor, 1)} active={editor?.isActive('heading', { level: 1 })} label="H1" title="标题1 (Ctrl+Alt+1)" />
        <ToolBtn onClick={() => editor && headingButtonAction(editor, 2)} active={editor?.isActive('heading', { level: 2 })} label="H2" title="标题2 (Ctrl+Alt+2)" />
        <ToolBtn onClick={() => editor && headingButtonAction(editor, 3)} active={editor?.isActive('heading', { level: 3 })} label="H3" title="标题3 (Ctrl+Alt+3)" />
        <ToolBtn onClick={() => editor && headingButtonAction(editor, 4)} active={editor?.isActive('heading', { level: 4 })} label="H4" title="标题4 (Ctrl+Alt+4)" />
        <ToolBtn onClick={() => editor?.chain().focus().setParagraph().run()} active={editor?.isActive('paragraph')} label="P" title="正文" />
        <ColorSplitButton
          glyph="H"
          barColor={headingBarColor}
          active={!!headingBlock && !!headingCurColor}
          title="标题颜色（作用于光标所在整行标题）"
          popTitle="标题颜色"
          current={headingColor}
          onMain={toggleHeadingColor}
          onPick={pickHeadingColor}
        />

        <ToolSep />

        {/* 代码块：主按钮切换代码块，caret 弹层切换配色主题（持久化） */}
        <SplitButton
          main={<span className="tb-ul-glyph">&lt;/&gt;</span>}
          active={editor?.isActive('codeBlock')}
          title="代码块 (Alt+L)"
          popTitle="代码配色"
          onMain={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          {(close) => (
            <div className="tb-code-theme-list">
              {CODE_THEMES.map(th => (
                <button
                  type="button"
                  key={th.id}
                  role="menuitemradio"
                  aria-checked={codeTheme === th.id}
                  className={`tb-code-theme${codeTheme === th.id ? ' current' : ''}`}
                  title={`代码配色：${th.t}`}
                  onClick={() => { close(); setCodeThemeState(th.id); setCodeTheme(th.id); }}
                >
                  <span className="tb-code-theme-chip" style={{ background: th.bg }} aria-hidden="true" />
                  <span className="tb-code-theme-name">{th.t}</span>
                </button>
              ))}
            </div>
          )}
        </SplitButton>
        <ToolBtn onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} label="❝" title="引用" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} label="•" title="无序列表" />
        <ToolBtn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} label="1." title="有序列表" />
        <ToolBtn onClick={() => editor?.chain().focus().setHorizontalRule().run()} label="—" title="分割线" />
        <ToolBtn onClick={() => fileInputRef.current?.click()} label="图片" title="插入图片（或直接粘贴截图）" wide />

        <ToolSep />

        <ColorSplitButton
          glyph="A"
          barColor={fontBarColor}
          active={!!fontSelColor && fontSelColor === fontColor}
          title="字体颜色 (Ctrl+Alt+R/B/Y/G/P)"
          popTitle="字体颜色"
          current={fontColor}
          onMain={toggleFontColor}
          onPick={pickFontColor}
        />

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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = '';
        }}
      />

    </>
  );
}

function ToolBtn({ onClick, active, label, title, wide }: {
  onClick: () => void; active?: boolean; label: React.ReactNode; title?: string; wide?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={`toolbar-btn${active ? ' active' : ''}`} title={title} aria-label={title}
      style={{ ...(wide ? { width: 'auto', padding: '0 8px', fontSize: 12 } : {}) }}>
      {label}
    </button>
  );
}

function ToolSep() {
  return <div style={{ width: 1, height: 20, background: '#d0d0d0', margin: '0 4px' }} />;
}
