import { getRenderedAttributes, mergeAttributes, ResizableNodeView } from '@tiptap/core';
import type { ResizableNodeViewDirection } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import type { ImageOptions } from '@tiptap/extension-image';

// 当前文档的图片展示 URL 前缀（如 /api/raw/categories/agent）。
// md 中保存的是相对路径 images/xxx.png，浏览器展示时通过该前缀解析。
let currentImageBase = '';

export function setImageBase(base: string) {
  currentImageBase = base || '';
}

export function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  if (currentImageBase) return `${currentImageBase.replace(/\/+$/, '')}/${src.replace(/^\.\//, '')}`;
  return src;
}

function escapeAttr(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseWidth(el: HTMLElement): number | null {
  const fromAttr = parseInt(el.getAttribute('width') || '', 10);
  if (fromAttr) return fromAttr;
  const style = (el.style.width || '').match(/(\d+)px/);
  return style ? parseInt(style[1], 10) : null;
}

interface ResizableImageOptions extends Omit<ImageOptions, 'resize'> {
  resize: {
    enabled: boolean;
    directions: ResizableNodeViewDirection[];
    preserveAspectRatio: boolean;
    min: { width: number; height: number };
    className: { container: string; handle: string; resizing: string };
  };
}

export const ResizableImage = Image.extend<ResizableImageOptions>({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
      HTMLAttributes: {},
      resize: {
        enabled: true,
        directions: ['bottom-right'],
        preserveAspectRatio: true,
        min: { width: 40, height: 20 },
        className: {
          container: 'image-node-container',
          handle: 'image-resize-handle',
          resizing: 'image-node-resizing',
        },
      },
    };
  },

  addAttributes() {
    return {
      // 编辑器内复制粘贴图片时，HTML 中的 src 是解析后的 /api/raw/... 路径，剥离前缀还原为 md 相对路径
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('src') || '';
          if (currentImageBase && raw.startsWith(`${currentImageBase}/`)) {
            return raw.slice(currentImageBase.length + 1);
          }
          return raw;
        },
      },
      alt: { default: null },
      title: { default: null },
      // 只持久化宽度：高度由浏览器按图片原始比例自动推导，保证长宽比永不畸变
      width: { default: null, parseHTML: (el: HTMLElement) => parseWidth(el) },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    if (attrs.src) attrs.src = resolveImageSrc(attrs.src as string);
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
  },

  // 有尺寸时序列化为 HTML <img width=...>（GitHub 与 marked 均支持），否则用标准 markdown 语法。
  // 不写 height：等比例缩放由浏览器自动保证
  renderMarkdown(node: any) {
    const src = node.attrs?.src ?? '';
    const alt = node.attrs?.alt ?? '';
    const width = node.attrs?.width;
    if (width) {
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" width="${width}">`;
    }
    return `![${alt}](${src})`;
  },

  addNodeView() {
    if (!this.options.resize?.enabled || typeof document === 'undefined') return null;

    const { directions, min, preserveAspectRatio, className } = this.options.resize;
    const resizeManagedAttributes = new Set(['src', 'width', 'height']);

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const el = document.createElement('img');
      el.draggable = false;
      const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
      Object.entries(mergedAttributes).forEach(([key, value]) => {
        if (value != null && !resizeManagedAttributes.has(key)) el.setAttribute(key, value);
      });

      const syncImageSource = (src: string) => {
        const resolved = resolveImageSrc(src || '');
        if (typeof resolved === 'string' && resolved !== '') {
          if (el.getAttribute('src') !== resolved) el.src = resolved;
          return;
        }
        if (el.hasAttribute('src')) el.removeAttribute('src');
        if (el.src !== '') el.src = '';
      };
      syncImageSource(mergedAttributes.src);

      let previousHTMLAttributes = { ...HTMLAttributes };
      const onUpdate = (updatedNode: any) => {
        if (updatedNode.type !== node.type) return false;
        const extensionAttributes = editor.extensionManager.attributes.filter(
          (attribute) => attribute.type === updatedNode.type.name,
        );
        const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
        Object.keys(previousHTMLAttributes).forEach((key) => {
          if (!resizeManagedAttributes.has(key) && !(key in newHTMLAttributes)) el.removeAttribute(key);
        });
        Object.entries(newHTMLAttributes).forEach(([key, value]) => {
          if (resizeManagedAttributes.has(key)) return;
          if (value != null) el.setAttribute(key, value);
          else el.removeAttribute(key);
        });
        syncImageSource(newHTMLAttributes.src);
        // width 变更（预设按钮、回读等）即时同步样式；高度保持自动推导
        const w = updatedNode.attrs?.width;
        el.style.width = w ? `${w}px` : '';
        previousHTMLAttributes = newHTMLAttributes;
        return true;
      };

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
        },
        onCommit: (width) => {
          const pos = getPos();
          if (pos === undefined) return;
          // 只提交宽度，高度回到自动推导，保证等比例
          el.style.height = '';
          editor.chain().setNodeSelection(pos).updateAttributes('image', { width }).run();
        },
        onUpdate,
        options: {
          directions,
          min,
          preserveAspectRatio,
          className,
        },
      });

      // 选中工具栏：宽度预设 / 原始大小 / 删除
      const toolbar = document.createElement('div');
      toolbar.className = 'image-node-toolbar';

      const contentWidth = () => {
        const dom = editor.view.dom;
        const cs = window.getComputedStyle(dom);
        return dom.getBoundingClientRect().width
          - parseFloat(cs.paddingLeft || '0')
          - parseFloat(cs.paddingRight || '0');
      };

      const addBtn = (label: string, title: string, onClick: () => void) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'image-node-toolbar-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        toolbar.appendChild(btn);
      };

      const applyWidth = (width: number | null) => {
        const pos = getPos();
        if (pos === undefined) return;
        editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { width }).run();
      };

      [0.25, 0.5, 0.75, 1].forEach((pct) => {
        addBtn(`${pct * 100}%`, `宽度设为 ${pct * 100}%`, () => {
          applyWidth(Math.max(40, Math.round(contentWidth() * pct)));
        });
      });
      addBtn('原始', '恢复原始大小', () => applyWidth(null));
      addBtn('×', '删除图片', () => {
        const pos = getPos();
        if (pos === undefined) return;
        editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
      });

      nodeView.container.appendChild(toolbar);
      return nodeView;
    };
  },
});
