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
import { Extension, Mark } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { Plugin } from '@tiptap/pm/state';
import { Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { Markdown } from '@tiptap/markdown';
import { useState, useCallback, useEffect, useRef } from 'react';
import { setActiveEditor } from '@/lib/activeEditor';
import { mdToHtml, stripMdText } from '@/lib/markdown';
import { ResizableImage, setImageBase } from '@/lib/resizableImage';

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

// 索引链接 mark：[[文档#H2#H3]] 语法
// code: true 让 markdown 序列化器跳过转义，保证 [[...]] 原样写回文件
const WikiLinkMark = Mark.create({
  name: 'wikiLink',
  code: true,
  inclusive: true,
  addAttributes() {
    return {
      wiki: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-wiki'),
      },
      broken: {
        default: false,
        parseHTML: (el: HTMLElement) => el.classList.contains('wiki-broken'),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'a.wiki-link' }];
  },
  renderHTML({ HTMLAttributes }) {
    // 不带 href：避免 TipTap Link 插件 openOnClick 拦截并打开新页面
    const cls = HTMLAttributes.broken ? 'wiki-link wiki-broken' : 'wiki-link';
    return ['a', { class: cls, 'data-wiki': HTMLAttributes.wiki }, 0];
  },
});

// 反向索引挂件数据（组件通过 prop 写入，插件在 decorations 中读取）
export interface BacklinkEntry {
  sourceDocKey: string;
  sourceTitle: string;
  contextAnchor: string[];
}

let globalBacklinkMap: Record<string, BacklinkEntry[]> = {};

export function setGlobalBacklinkMap(map: Record<string, BacklinkEntry[]>) {
  globalBacklinkMap = map || {};
}

// 在被引用标题后渲染黄色反向索引 chip，点击跳回源文档
const BacklinkChipExtension = Extension.create({
  name: 'backlinkChip',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'heading') return true;
              const text = stripMdText(node.textContent || '');
              const entries = globalBacklinkMap[text];
              if (!entries || entries.length === 0) return;
              const widget = document.createElement('span');
              widget.className = 'backlink-chip-wrapper';
              const chip = document.createElement('button');
              chip.type = 'button';
              chip.className = 'backlink-chip';
              chip.textContent = `↩ ${entries.length}`;
              chip.title = entries.map(e => e.sourceTitle).join('\n');
              widget.appendChild(chip);

              let popover: HTMLDivElement | null = null;
              chip.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (entries.length === 1) {
                  const e0 = entries[0];
                  window.dispatchEvent(new CustomEvent('open-wiki-link', {
                    detail: { wiki: [e0.sourceDocKey, ...e0.contextAnchor].filter(Boolean).join('#') },
                  }));
                  return;
                }
                if (popover) { popover.remove(); popover = null; return; }
                popover = document.createElement('div');
                popover.className = 'backlink-chip-popover';
                for (const e of entries) {
                  const item = document.createElement('button');
                  item.type = 'button';
                  item.className = 'backlink-chip-item';
                  item.textContent = e.sourceTitle;
                  item.addEventListener('click', (ev2) => {
                    ev2.preventDefault();
                    ev2.stopPropagation();
                    window.dispatchEvent(new CustomEvent('open-wiki-link', {
                      detail: { wiki: [e.sourceDocKey, ...e.contextAnchor].filter(Boolean).join('#') },
                    }));
                    popover?.remove();
                    popover = null;
                  });
                  popover.appendChild(item);
                }
                widget.appendChild(popover);
              });

              // 放在标题节点内部末尾（nodeSize - 1），使 chip 与标题同行显示
              decos.push(Decoration.widget(pos + node.nodeSize - 1, () => widget, { side: 1 }));
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
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

// --- 剪贴板混合内容粘贴（文字 + 图片）处理 ---

function extOfMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return map[mime] || 'png';
}

async function uploadPastedImage(file: File, dir: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('dir', dir);
    const res = await fetch('/api/upload-image', { method: 'POST', body: form });
    const json = await res.json();
    return json.success && json.src ? (json.src as string) : null;
  } catch {
    return null;
  }
}

async function importLocalImage(fileUrl: string, dir: string): Promise<string | null> {
  try {
    let p = fileUrl.replace(/^file:\/\//i, '');
    p = p.replace(/^localhost\//i, '').replace(/^\//, '');
    const res = await fetch('/api/import-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, localPath: decodeURIComponent(p) }),
    });
    const json = await res.json();
    return json.success && json.src ? (json.src as string) : null;
  } catch {
    return null;
  }
}

// 远程图片由本地后端代为拉取，规避浏览器 CORS 限制
async function importRemoteImage(url: string, dir: string): Promise<string | null> {
  try {
    const res = await fetch('/api/import-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, remoteUrl: url }),
    });
    const json = await res.json();
    return json.success && json.src ? (json.src as string) : null;
  } catch {
    return null;
  }
}

async function uploadDataUri(dataUri: string, dir: string): Promise<string | null> {
  try {
    const mime = dataUri.match(/^data:([^;,]+)/)?.[1] || 'image/png';
    const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return await uploadPastedImage(new File([arr], `pasted.${extOfMime(mime)}`, { type: mime }), dir);
  } catch {
    return null;
  }
}

// 解析剪贴板 HTML：逐个持久化 <img> 并替换 src，失败则移除该图片保留文字。
// 返回 usedFiles：已消耗的剪贴板文件项数量，剩余的由调用方兜底直插
async function processClipboardHtml(
  html: string,
  files: File[],
  dir: string,
): Promise<{ html: string; failed: number; usedFiles: number }> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  let fileIndex = 0;
  let failed = 0;
  for (const img of imgs) {
    const rawSrc = img.getAttribute('src') || '';
    let newSrc: string | null = null;
    if (files[fileIndex]) {
      newSrc = await uploadPastedImage(files[fileIndex], dir);
      fileIndex += 1;
    } else if (rawSrc.startsWith('data:')) {
      newSrc = await uploadDataUri(rawSrc, dir);
    } else if (/^file:\/\//i.test(rawSrc)) {
      newSrc = await importLocalImage(rawSrc, dir);
    } else if (rawSrc.startsWith('blob:')) {
      try {
        const blob = await fetch(rawSrc).then((r) => r.blob());
        newSrc = await uploadPastedImage(new File([blob], `blob.${extOfMime(blob.type)}`, { type: blob.type }), dir);
      } catch {
        newSrc = null;
      }
    } else if (/^https?:/i.test(rawSrc)) {
      newSrc = await importRemoteImage(rawSrc, dir);
    }
    if (newSrc) {
      img.setAttribute('src', newSrc);
      img.removeAttribute('srcset');
    } else {
      failed += 1;
      img.remove();
    }
  }
  return { html: doc.body.innerHTML, failed, usedFiles: fileIndex };
}

// 解析文档内索引链接（相对路径）：区分文档 / 标签 / 索引文件
function parseInternalLink(
  href: string,
): { kind: 'doc' | 'tag' | 'index'; key: string; anchor: string; slugHint: string } | null {
  if (!href) return null;
  const normalized = href.replace(/\\/g, '/');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized) || normalized.startsWith('//')) return null;
  const hashIdx = normalized.indexOf('#');
  const pathPart = hashIdx >= 0 ? normalized.slice(0, hashIdx) : normalized;
  const fragmentRaw = hashIdx >= 0 ? normalized.slice(hashIdx + 1) : '';
  let anchor = '';
  try { anchor = decodeURIComponent(fragmentRaw); } catch { anchor = fragmentRaw; }
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length === 0) return null; // 纯页内锚点
  let base = segments[segments.length - 1];
  try { base = decodeURIComponent(base); } catch {}
  const noExt = base.replace(/\.md$/i, '');
  const tagsIdx = segments.indexOf('tags');
  if (tagsIdx >= 0) return { kind: 'tag', key: noExt, anchor, slugHint: '' };
  let slugHint = '';
  if (segments.length >= 2) {
    try { slugHint = decodeURIComponent(segments[segments.length - 2]); } catch { slugHint = segments[segments.length - 2]; }
  }
  if (/^00-index$/i.test(noExt)) return { kind: 'index', key: slugHint, anchor, slugHint };
  if (/^\d{3}-/.test(noExt)) return { kind: 'doc', key: noExt, anchor, slugHint };
  return null;
}

// --- Props ---
interface Props {
  placeholder?: string;
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  documentTitle?: string;
  sectionName?: string;
  backlinkMap?: Record<string, BacklinkEntry[]>;
  /** 图片展示 URL 前缀，如 /api/raw/categories/agent */
  imageBase?: string;
  /** 文档所在仓库内目录，用于图片上传定位，如 categories/agent */
  uploadDir?: string;
}

export default function WysiwygEditor({ placeholder = '', initialMarkdown = '', onChange, readOnly = false, documentTitle = '', sectionName = '', backlinkMap, imageBase = '', uploadDir = '' }: Props) {
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

  // 图片相对路径解析前缀：同一文档的所有编辑器共享同一目录，模块级注册即可
  setImageBase(imageBase);

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
      WikiLinkMark,
      BacklinkChipExtension,
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
      ResizableImage,
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
      handlePaste: (view, event) => {
        // 剪贴板数据必须在事件回调内同步读取
        const files = Array.from(event.clipboardData?.items || [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter((f): f is File => !!f);
        const html = event.clipboardData?.getData('text/html') || '';
        const hasImg = /<img[\s>]/i.test(html);
        if (files.length === 0 && !hasImg) return false;

        event.preventDefault();
        if (!uploadDir) {
          alert('当前编辑器不支持插入图片（缺少文档目录信息）');
          return true;
        }

        // 诊断日志：粘贴异常时可通过 F12 控制台查看剪贴板实际格式
        console.debug('[paste-debug]', {
          fileCount: files.length,
          fileTypes: files.map((f) => f.type),
          htmlLen: html.length,
          hasImg,
          htmlPreview: html.slice(0, 200),
        });

        (async () => {
          const ed = editorRef.current;
          if (!ed || ed.isDestroyed) return;
          if (hasImg) {
            // 文字 + 图片一起粘贴：图片逐个持久化后替换 src，再整体插入
            const { html: processedHtml, failed, usedFiles } = await processClipboardHtml(html, files, uploadDir);
            ed.chain().focus().insertContent(processedHtml).run();
            // 兜底：HTML 中未用到的剪贴板文件项（如 HTML 解析失败）直接插入为图片节点
            for (let i = usedFiles; i < files.length; i++) {
              const src = await uploadPastedImage(files[i], uploadDir);
              if (!src) continue;
              const node = ed.state.schema.nodes.image.create({ src, alt: '' });
              ed.view.dispatch(ed.state.tr.replaceSelectionWith(node));
            }
            if (failed > 0) {
              alert(`${failed} 张图片无法读取（本地文件已失效或需要登录），文字已保留，请对缺失图片单独截图后粘贴`);
            }
          } else {
            for (const file of files) {
              const src = await uploadPastedImage(file, uploadDir);
              if (!src) {
                alert('图片上传失败');
                continue;
              }
              const node = ed.state.schema.nodes.image.create({ src, alt: '' });
              ed.view.dispatch(ed.state.tr.replaceSelectionWith(node));
            }
          }
        })();
        return true;
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
      // 解析 wiki 链接状态：模型级更新（改名渲染文本、失效标红），避免直接改 DOM 破坏 ProseMirror
      const timer = setTimeout(() => resolveWikiLinks(), 100);
      return () => clearTimeout(timer);
    }
  }, [editor, initialMarkdown]);

  // 通过事务在编辑器模型内更新 wiki 链接：改名 → 文本收敛为新路径；失效 → 标记 broken 标红
  async function resolveWikiLinks() {
    if (!editor || editor.isDestroyed) return;
    const wikiSet = new Set<string>();
    editor.state.doc.descendants((node) => {
      node.marks?.forEach((mark) => {
        if (mark.type.name === 'wikiLink' && mark.attrs?.wiki) wikiSet.add(mark.attrs.wiki);
      });
    });
    if (wikiSet.size === 0) return;
    try {
      const res = await fetch('/api/resolve-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: Array.from(wikiSet) }),
      });
      const json = await res.json();
      if (!json.success) return;
      const data = json.data as Record<string, { found: boolean; status?: string; resolvedPath?: string[] }>;
      if (editor.isDestroyed) return;

      const tr = editor.state.tr;
      let changed = false;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return true;
        node.marks.forEach((mark) => {
          if (mark.type.name !== 'wikiLink') return;
          const wiki = mark.attrs?.wiki;
          if (!wiki) return;
          const r = data[wiki];
          if (!r) return;
          const newAttrs = { ...mark.attrs };
          if (!r.found || r.status === 'broken' || r.status === 'partial') {
            newAttrs.broken = true;
          }
          // 改名收敛：文本更新为当前有效锚点路径
          const display = r.resolvedPath && r.resolvedPath.length > 0
            ? `[[${wiki.split('#')[0]}#${r.resolvedPath.join('#')}]]`
            : `[[${wiki.split('#')[0]}]]`;
          const otherMarks = node.marks.filter((m) => m.type.name !== 'wikiLink');
          const newMarks = [editor.schema.marks.wikiLink.create(newAttrs), ...otherMarks];
          tr.replaceWith(pos, pos + node.nodeSize, editor.schema.text(display, newMarks));
          changed = true;
        });
      });
      if (changed) editor.view.dispatch(tr);
    } catch {}
  }

  // Register as active editor on focus, tagging with section name
  useEffect(() => {
    if (!editor) return;
    const handler = () => setActiveEditor(editor, sectionName, uploadDir);
    editor.on('focus', handler);
    return () => { editor.off('focus', handler); };
  }, [editor, sectionName, uploadDir]);
  // Set as active on mount if this is the first editor
  useEffect(() => {
    if (editor) {
      const el = editor.view.dom;
      const handler = () => setActiveEditor(editor, sectionName, uploadDir);
      el.addEventListener('focusin', handler);
      return () => el.removeEventListener('focusin', handler);
    }
  }, [editor, sectionName, uploadDir]);

  // Tag editor DOM with section name for annotation targeting
  useEffect(() => {
    if (editor) editor.view.dom.setAttribute('data-section', sectionName || '');
  }, [editor, sectionName]);

  // 同步反向索引数据到插件，并触发 decorations 重算
  useEffect(() => {
    setGlobalBacklinkMap(backlinkMap || {});
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [backlinkMap, editor]);

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
      <div
        className={`wysiwyg-content ${mode === 'read' ? 'read-mode' : ''}`}
        onClickCapture={(e) => {
          const anchorEl = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null;
          if (!anchorEl) return;

          // [[...]] wiki 链接
          const wikiAttr = anchorEl.getAttribute('data-wiki');
          if (wikiAttr) {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-wiki-link', { detail: { wiki: wikiAttr } }));
            return;
          }

          const parsed = parseInternalLink(anchorEl.getAttribute('href') || '');
          if (!parsed) return;
          e.preventDefault();
          e.stopPropagation();
          if (parsed.kind === 'doc') {
            window.dispatchEvent(new CustomEvent('open-wiki-link', {
              detail: { wiki: [parsed.key, parsed.anchor].filter(Boolean).join('#'), slugHint: parsed.slugHint },
            }));
          } else if (parsed.kind === 'tag') {
            window.dispatchEvent(new CustomEvent('open-wiki-link', {
              detail: { kind: 'tag', wiki: parsed.key },
            }));
          } else {
            // 索引文件：优先用链接路径中的目录段，否则回退到当前文档所在目录
            const slug = parsed.key || uploadDir.split('/').filter(Boolean).slice(-1)[0] || '';
            window.dispatchEvent(new CustomEvent('open-wiki-link', {
              detail: { kind: 'index', wiki: slug },
            }));
          }
        }}
      >
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
