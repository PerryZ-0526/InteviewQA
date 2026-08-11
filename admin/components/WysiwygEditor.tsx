'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { BulletList } from '@tiptap/extension-bullet-list';
import { ListItem } from '@tiptap/extension-list-item';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import { HardBreak } from '@tiptap/extension-hard-break';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Markdown } from '@tiptap/markdown';
import { useState, useCallback, useEffect, useRef } from 'react';
import { setActiveEditor } from '@/lib/activeEditor';
import { mdToHtml } from '@/lib/markdown';

// --- Custom FontSize extension ---
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: Record<string, string | null>) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }: { chain: any }) =>
          chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }: { chain: any }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

// --- Custom BackgroundColor extension ---
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    backgroundColor: {
      setBackgroundColor: (color: string) => ReturnType;
      unsetBackgroundColor: () => ReturnType;
    };
  }
}

const BackgroundColor = Extension.create({
  name: 'backgroundColor',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
            renderHTML: (attributes: Record<string, string | null>) => {
              if (!attributes.backgroundColor) return {};
              return { style: `background-color: ${attributes.backgroundColor}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setBackgroundColor:
        (color: string) =>
        ({ chain }: { chain: any }) =>
          chain().setMark('textStyle', { backgroundColor: color }).run(),
      unsetBackgroundColor:
        () =>
        ({ chain }: { chain: any }) =>
          chain().setMark('textStyle', { backgroundColor: null }).removeEmptyTextStyle().run(),
    };
  },
});

// 将文本颜色、字号和背景色保留为 Markdown 内联 HTML，避免保存时丢失样式
const MarkdownTextStyle = TextStyle.extend({
  renderMarkdown(node, helpers) {
    const styles: string[] = [];
    if (node.attrs?.color) styles.push(`color: ${node.attrs.color}`);
    if (node.attrs?.fontSize) styles.push(`font-size: ${node.attrs.fontSize}`);
    if (node.attrs?.backgroundColor) styles.push(`background-color: ${node.attrs.backgroundColor}`);
    const content = helpers.renderChildren(node);
    return styles.length > 0 ? `<span style="${styles.join('; ')}">${content}</span>` : content;
  },
});

// 将相邻列表的首项缩进到前一个列表的末项下，支持有序列表与无序列表混合嵌套
function sinkAcrossAdjacentLists(view: EditorView): boolean {
  const { $from, $to } = view.state.selection;
  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'listItem') {
      listItemDepth = depth;
      break;
    }
  }
  if (listItemDepth < 2) return false;

  const listDepth = listItemDepth - 1;
  const sourceList = $from.node(listDepth);
  if ($to.depth < listDepth || $to.node(listDepth) !== sourceList) return false;

  const firstSelectedIndex = $from.index(listDepth);
  const lastSelectedIndex = $to.index(listDepth);
  if (firstSelectedIndex !== 0) return false;

  const parent = $from.node(listDepth - 1);
  const sourceListIndex = $from.index(listDepth - 1);
  if (sourceListIndex === 0) return false;

  const previousList = parent.child(sourceListIndex - 1);
  if (!['bulletList', 'orderedList'].includes(previousList.type.name)) return false;

  const selectedItems = Fragment.fromArray(
    Array.from({ length: lastSelectedIndex + 1 }, (_, index) => sourceList.child(index)),
  );
  const previousLastItem = previousList.lastChild;
  if (!previousLastItem || previousLastItem.type.name !== 'listItem') return false;

  const previousItemChildren = Array.from(
    { length: previousLastItem.childCount },
    (_, index) => previousLastItem.child(index),
  );
  const existingNestedList = previousLastItem.lastChild;
  if (existingNestedList?.type === sourceList.type) {
    previousItemChildren[previousItemChildren.length - 1] = existingNestedList.copy(
      existingNestedList.content.append(selectedItems),
    );
  } else {
    previousItemChildren.push(sourceList.copy(selectedItems));
  }

  const updatedPreviousLastItem = previousLastItem.copy(Fragment.fromArray(previousItemChildren));
  const previousListItems = Array.from(
    { length: previousList.childCount },
    (_, index) => index === previousList.childCount - 1
      ? updatedPreviousLastItem
      : previousList.child(index),
  );
  const replacement = [previousList.copy(Fragment.fromArray(previousListItems))];

  if (lastSelectedIndex + 1 < sourceList.childCount) {
    const remainingItems = Array.from(
      { length: sourceList.childCount - lastSelectedIndex - 1 },
      (_, index) => sourceList.child(lastSelectedIndex + 1 + index),
    );
    replacement.push(sourceList.copy(Fragment.fromArray(remainingItems)));
  }

  const sourceListStart = $from.before(listDepth);
  const previousListStart = sourceListStart - previousList.nodeSize;
  const transaction = view.state.tr.replaceWith(
    previousListStart,
    sourceListStart + sourceList.nodeSize,
    Fragment.fromArray(replacement),
  );
  const firstMovedItem = sourceList.firstChild;
  let firstMovedItemPosition = -1;
  transaction.doc.descendants((node, position) => {
    if (node === firstMovedItem) {
      firstMovedItemPosition = position;
      return false;
    }
    return true;
  });
  if (firstMovedItemPosition >= 0) {
    transaction.setSelection(
      Selection.near(transaction.doc.resolve(firstMovedItemPosition + 1), 1),
    );
  }
  view.dispatch(transaction.scrollIntoView());
  return true;
}

// --- Props ---
interface Props {
  placeholder?: string;
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  documentTitle?: string;
  sectionName?: string;
}

export default function WysiwygEditor({ placeholder = '', initialMarkdown = '', onChange, readOnly = false, documentTitle = '', sectionName = '' }: Props) {
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const initializedRef = useRef(false);

  // AI Rewrite state
  const [aiState, setAiState] = useState<'idle' | 'input' | 'loading' | 'done'>('idle');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiOriginal, setAiOriginal] = useState('');
  const [aiRewritten, setAiRewritten] = useState('');
  const aiInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<any>(null);

  const initialHtml = initialMarkdown ? mdToHtml(initialMarkdown) : '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 代码块内使用 Tab 和 Shift+Tab 进行四空格缩进或反缩进
        codeBlock: { HTMLAttributes: { class: 'code-block' }, enableTabIndentation: true, tabSize: 4 },
        heading: { levels: [1, 2, 3, 4] },
        link: false,
        underline: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        hardBreak: false,
      }),
      // 自定义 HardBreak：mdToHtml 用 breaks:true 加载，单个 \n 即转 <br>，
      // 用两个空格+换行反而会变成双重换行
      HardBreak.extend({
        renderMarkdown() {
          return '\n';
        },
      }),
      Highlight,
      Underline,
      MarkdownTextStyle,
      Color,
      FontSize,
      BackgroundColor,
      Link.configure({ openOnClick: true, HTMLAttributes: { target: '_blank' } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      OrderedList,
      BulletList,
      ListItem,
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editable: mode === 'edit' && !readOnly,
    onUpdate: ({ editor }) => {
      if (onChange) {
        let md = editor.getMarkdown();
        // 合并代码块末尾多余空行
        md = md.replace(/\n+(```)/g, '\n$1');
        onChange(md);
      }
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Tab') return false;

        const { $from } = view.state.selection;
        // 列表中的代码块继续使用代码块自身的空格缩进逻辑
        if ($from.parent.type.name === 'codeBlock') return false;

        let isInsideListItem = false;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === 'listItem') {
            isInsideListItem = true;
            break;
          }
        }
        if (!isInsideListItem) return false;

        // 列表内直接接管 Tab，避免浏览器把焦点跳到工具栏或其他控件
        event.preventDefault();
        const listItemType = view.state.schema.nodes.listItem;
        const command = event.shiftKey
          ? liftListItem(listItemType)
          : sinkListItem(listItemType);
        const handled = command(view.state, (transaction) => view.dispatch(transaction));
        if (!handled && !event.shiftKey) sinkAcrossAdjacentLists(view);
        return true;
      },
    },
  });

  // Only set initial content once on mount. After that, the editor owns the state.
  useEffect(() => {
    if (editor && !initializedRef.current && initialMarkdown) {
      initializedRef.current = true;
      const html = mdToHtml(initialMarkdown);
      editor.commands.setContent(html);
    }
  }, [editor, initialMarkdown]);

  // Register as active editor on focus, tagging with section name
  useEffect(() => {
    if (!editor) return;
    const handler = () => setActiveEditor(editor, sectionName);
    editor.on('focus', handler);
    return () => { editor.off('focus', handler); };
  }, [editor, sectionName]);
  // Set as active on mount if this is the first editor
  useEffect(() => {
    if (editor) {
      const el = editor.view.dom;
      const handler = () => setActiveEditor(editor, sectionName);
      el.addEventListener('focusin', handler);
      return () => el.removeEventListener('focusin', handler);
    }
  }, [editor, sectionName]);

  // Tag editor DOM with section name for annotation targeting
  useEffect(() => {
    if (editor) editor.view.dom.setAttribute('data-section', sectionName || '');
  }, [editor, sectionName]);

  // 从批注卡片定位对应原文，用指纹（前5字+选中+后5字）唯一匹配
  useEffect(() => {
    if (!editor) return;
    const handler = (event: Event) => {
      const d = (event as CustomEvent<{ quote?: string; fingerPrint?: string; quoteOffset?: number }>).detail;
      const key = d?.fingerPrint || d?.quote;
      const offset = d?.quoteOffset || 0;
      if (!key) return;

      const segments: Array<{ textStart: number; textEnd: number; docStart: number }> = [];
      let fullText = '';
      editor.state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return;
        const textStart = fullText.length;
        fullText += node.text;
        segments.push({ textStart, textEnd: fullText.length, docStart: position });
      });

      const matchStart = fullText.indexOf(key);
      if (matchStart < 0) return;
      const quoteStart = matchStart + offset;
      const matchEnd = quoteStart + (d?.quote || key).length;
      const startSegment = segments.find(s => quoteStart >= s.textStart && quoteStart < s.textEnd);
      const endSegment = segments.find(s => matchEnd > s.textStart && matchEnd <= s.textEnd);
      if (!startSegment || !endSegment) return;

      const from = startSegment.docStart + quoteStart - startSegment.textStart;
      const coordinates = editor.view.coordsAtPos(from);
      const scrollContainer = editor.view.dom.closest<HTMLElement>('.content');
      editor.commands.setTextSelection(from);
      editor.commands.blur();
      window.getSelection()?.removeAllRanges();
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        scrollContainer.scrollTo({
          top: scrollContainer.scrollTop + coordinates.top - containerRect.top - scrollContainer.clientHeight / 2,
          behavior: 'smooth',
        });
      }
    };
    window.addEventListener('select-annotation-quote', handler);
    return () => window.removeEventListener('select-annotation-quote', handler);
  }, [editor]);

  // Keep editorRef in sync
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // AI Rewrite: detect selection
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const { from, to } = editor.state.selection;
      const has = from !== to;
      if (has !== hasSelection) setHasSelection(has);
    };
    // ProseMirror events
    editor.on('selectionUpdate', check);
    editor.on('transaction', check);
    // Also check on mouseup/keyup via DOM
    const domCheck = () => setTimeout(check, 20);
    const el = editor.view.dom;
    el.addEventListener('mouseup', domCheck);
    el.addEventListener('keyup', domCheck);
    return () => {
      editor.off('selectionUpdate', check);
      editor.off('transaction', check);
      el.removeEventListener('mouseup', domCheck);
      el.removeEventListener('keyup', domCheck);
    };
  }, [editor, hasSelection]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'edit' ? 'read' : 'edit';
      if (editor) editor.setEditable(next === 'edit' && !readOnly);
      return next;
    });
  }, [editor, readOnly]);

  if (!editor) {
    return <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>加载编辑器...</div>;
  }

  return (
    <div className="wysiwyg-container" data-mode={mode}>

      {/* Editor content */}
      <div className={`wysiwyg-content ${mode === 'read' ? 'read-mode' : ''}`}>
        <EditorContent editor={editor} />

        {/* Floating "AI 改写" button when text is selected */}
</div>
    </div>
  );
}

// --- Small toolbar components ---

function ToolBtn({ onClick, active, label, title, wide, hl }: {
  onClick: () => void;
  active?: boolean;
  label: React.ReactNode;
  title?: string;
  wide?: boolean;
  hl?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`toolbar-btn${active ? ' active' : ''}`}
      title={title}
      style={{
        ...(wide ? { width: 'auto', padding: '0 8px', fontSize: 12 } : {}),
        ...(hl && active ? { background: '#fff3cd' } : {}),
      }}
    >
      {label}
    </button>
  );
}

function ToolSep() {
  return <div style={{ width: 1, height: 20, background: '#d0d0d0', margin: '0 4px' }} />;
}
