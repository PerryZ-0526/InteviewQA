'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveEditor, getActiveSection } from '@/lib/activeEditor';
import { isVisibleInLayout } from '@/lib/domScroll';

interface Annotation {
  id: string;
  quote: string;
  text: string;
  createdAt: string;
  fingerPrint?: string;
}

interface Props {
  category: string;
  filename: string;
  context?: 'category' | 'project';
  onSelectQuote?: (quote: string) => void;
}

function apiBase(context: string, key: string, filename: string): string {
  if (context === 'project') return `/api/project/${key}/${filename}`;
  return `/api/categories/${key}/${filename}`;
}

interface Connector {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function findQuoteRange(ann: Annotation): Range | null {
  const key = ann.fingerPrint || ann.quote;
  const editors = document.querySelectorAll<HTMLElement>('.tiptap-editor');
  for (const editor of Array.from(editors)) {
    if (!isVisibleInLayout(editor)) continue;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let text = '';
    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
      current = walker.nextNode();
    }

    const matchStart = text.indexOf(key);
    if (matchStart < 0) continue;
    const quoteStart = matchStart + (ann.fingerPrint ? ann.fingerPrint.indexOf(ann.quote) : 0);
    const matchEnd = quoteStart + ann.quote.length;
    const startNode = nodes.find(item => quoteStart >= item.start && quoteStart < item.end);
    const endNode = nodes.find(item => matchEnd > item.start && matchEnd <= item.end);
    if (!startNode || !endNode) continue;

    const range = document.createRange();
    range.setStart(startNode.node, quoteStart - startNode.start);
    range.setEnd(endNode.node, matchEnd - endNode.start);
    return range;
  }
  return null;
}

function getCaretOffsetAtPoint(container: HTMLElement, x: number, y: number): number {
  const browserDocument = document as Document & {
    caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
  };
  const position = browserDocument.caretPositionFromPoint?.(x, y);
  const range = position ? null : browserDocument.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode || range?.startContainer;
  const offset = position?.offset ?? range?.startOffset;

  if (!node || offset === undefined || !container.contains(node)) {
    return container.textContent?.length || 0;
  }

  const prefix = document.createRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

export default function AnnotationPanel({ category, filename, context = 'category', onSelectQuote }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [annotationOrder, setAnnotationOrder] = useState<string[]>([]);
  const quoteRangesRef = useRef<Map<string, Range>>(new Map());
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editCaretRef = useRef<number | null>(null);

  // Focus textarea after panel opens, delayed to avoid transition / connector re-render stealing focus.
  // Only focus if not already focused — otherwise blur+refocus cycles through finishEdit.
  useEffect(() => {
    if (!editingId) return;
    const timer = setTimeout(() => {
      const input = editInputRef.current;
      if (input && document.activeElement !== input) {
        input.focus();
        if (editCaretRef.current !== null) {
          const caret = Math.min(editCaretRef.current, input.value.length);
          input.setSelectionRange(caret, caret);
          editCaretRef.current = null;
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editingId]);

  const load = useCallback(async () => {
    if (!category || !filename) return;
    try {
      const res = await fetch(`${apiBase(context, category, filename)}/annotations`);
      const json = await res.json();
      if (json.success) {
        const loaded = json.data || [];
        setAnnotations(loaded);
        setActiveId(current => current && loaded.some((ann: Annotation) => ann.id === current) ? current : loaded[0]?.id || null);
      }
    } catch {}
  }, [category, filename]);

  useEffect(() => { load(); }, [load]);

  const saveAll = useCallback(async (updated: Annotation[]) => {
    setAnnotations(updated);
    try {
      await fetch(`${apiBase(context, category, filename)}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: updated }),
      });
    } catch {}
  }, [category, filename]);

  // 编辑框展开到完整内容高度，并在不改变滚动位置的情况下放置光标
  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() => {
      const input = editInputRef.current;
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
      if (editCaretRef.current !== null) {
        const caret = Math.min(editCaretRef.current, input.value.length);
        input.focus({ preventScroll: true });
        input.setSelectionRange(caret, caret);
        editCaretRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId, editText]);

  // 输入停止后自动保存，避免每次按键都请求接口
  useEffect(() => {
    if (!editingId) return;
    const current = annotations.find(ann => ann.id === editingId);
    if (!current || current.text === editText) return;

    const timer = window.setTimeout(() => {
      saveAll(annotations.map(ann => ann.id === editingId ? { ...ann, text: editText } : ann));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [annotations, editText, editingId, saveAll]);

  const updateConnectors = useCallback(() => {
    if (!open) {
      setConnectors([]);
      return;
    }

    const nextConnectors: Connector[] = [];
    annotations.forEach(ann => {
      const range = quoteRangesRef.current.get(ann.id);
      const card = cardRefs.current.get(ann.id);
      if (!range || !card) return;

      const rangeRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      const anchor = rangeRects[rangeRects.length - 1];
      const cardRect = card.getBoundingClientRect();
      if (!anchor) return;

      nextConnectors.push({
        id: ann.id,
        startX: anchor.right + 4,
        startY: anchor.bottom + 1,
        endX: cardRect.left,
        endY: cardRect.top + 48,
      });
    });
    setConnectors(nextConnectors);
  }, [annotations, open]);

  // 批注原文使用浏览器高亮层展示，不修改编辑器正文内容
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const ranges = new Map<string, Range>();
      annotations.forEach(ann => {
        const range = findQuoteRange(ann);
        if (range) ranges.set(ann.id, range);
      });
      quoteRangesRef.current = ranges;
      const positionedIds = Array.from(ranges.entries())
        .sort(([, first], [, second]) => first.compareBoundaryPoints(Range.START_TO_START, second))
        .map(([id]) => id);
      const positionedSet = new Set(positionedIds);
      setAnnotationOrder([...positionedIds, ...annotations.filter(ann => !positionedSet.has(ann.id)).map(ann => ann.id)]);

      const highlightRegistry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }).highlights;
      const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
      if (highlightRegistry && HighlightConstructor) {
        highlightRegistry.delete('annotation-reference');
        if (ranges.size > 0) highlightRegistry.set('annotation-reference', new HighlightConstructor(...ranges.values()));
      }
      updateConnectors();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [annotations, updateConnectors]);

  // 面板滚动、正文滚动和窗口变化时同步刷新关联线位置
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateConnectors);
    };
    const transitionTimer = window.setTimeout(scheduleUpdate, 240);
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    return () => {
      window.clearTimeout(transitionTimer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [open, activeId, editingId, annotationOrder, updateConnectors]);

  useEffect(() => {
    return () => {
      const highlightRegistry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
      highlightRegistry?.delete('annotation-reference');
    };
  }, []);

  const ts = () => {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
  };

  const addAnnotation = (detail: { quote: string; sectionName?: string; contextBefore?: string; contextAfter?: string }) => {
    const id = Date.now().toString(36);
    const fp = (detail.contextBefore || '') + detail.quote + (detail.contextAfter || '');
    const ann: Annotation = { id, quote: detail.quote, text: '', createdAt: ts(), fingerPrint: fp };
    const updated = [...annotations, ann];
    setAnnotations(updated);
    setEditingId(id);
    setActiveId(id);
    setEditText('');
    editCaretRef.current = 0;
    setOpen(true);
  };

  const finishEdit = (id: string) => {
    const current = annotations.find(ann => ann.id === id);
    if (current && current.text !== editText) {
      saveAll(annotations.map(ann => ann.id === id ? { ...ann, text: editText } : ann));
    }
    setEditingId(null);
  };

  const removeAnnotation = (id: string) => {
    saveAll(annotations.filter(a => a.id !== id));
    if (editingId === id) setEditingId(null);
    if (activeId === id) setActiveId(null);
    setMenuId(null);
  };

  const startEdit = (ann: Annotation, caretOffset = ann.text.length) => {
    editCaretRef.current = caretOffset;
    setEditingId(ann.id);
    setActiveId(ann.id);
    setEditText(ann.text);
    setMenuId(null);
  };

  const selectAnnotation = (ann: Annotation) => {
    setActiveId(ann.id);
    const key = ann.fingerPrint || ann.quote;
    const qStart = ann.fingerPrint ? ann.fingerPrint.indexOf(ann.quote) : 0;
    window.dispatchEvent(new CustomEvent('select-annotation-quote', {
      detail: { quote: ann.quote, fingerPrint: key, quoteOffset: qStart },
    }));
    window.setTimeout(() => window.getSelection()?.removeAllRanges(), 0);
  };

  const count = annotations.length;
  const orderById = new Map(annotationOrder.map((id, index) => [id, index]));
  const orderedAnnotations = [...annotations].sort((first, second) => {
    const firstOrder = orderById.get(first.id) ?? Number.MAX_SAFE_INTEGER;
    const secondOrder = orderById.get(second.id) ?? Number.MAX_SAFE_INTEGER;
    return firstOrder - secondOrder;
  });

  return (
    <div className={`ann-panel${open ? ' is-open' : ''}`}>

      {open && connectors.length > 0 && (
        <svg className="ann-connectors" width="100%" height="100%" aria-hidden="true">
          {connectors.map(connector => (
            <g key={connector.id} className={connector.id === activeId ? 'is-active' : ''}>
              <path d={`M ${connector.startX} ${connector.startY} L ${connector.endX - 28} ${connector.startY} L ${connector.endX} ${connector.endY}`} />
              <circle cx={connector.startX} cy={connector.startY} r="3" />
            </g>
          ))}
        </svg>
      )}

      <button className="ann-toggle" onClick={() => {
        if (open) { setOpen(false); return; }
        const editor = getActiveEditor();
        if (editor) {
          const { from, to } = editor.state.selection;
          if (from !== to) {
            const doc = editor.state.doc;
            const quoteText = doc.textBetween(from, to);
            if (quoteText.trim()) {
              const ctxLen = 5;
              const ctxBefore = doc.textBetween(Math.max(0, from - ctxLen), from);
              const ctxAfter = doc.textBetween(to, Math.min(doc.content.size, to + ctxLen));
              addAnnotation({ quote: quoteText, sectionName: getActiveSection(), contextBefore: ctxBefore, contextAfter: ctxAfter });
              return;
            }
          }
        }
        setOpen(true);
      }} title={open ? '收起批注面板' : '展开批注面板'} aria-label={open ? '收起批注面板' : '展开批注面板'}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 15a3 3 0 01-3 3H8l-5 3V7a3 3 0 013-3h11a3 3 0 013 3z"/>
          <path d="M8 9h8M8 13h5"/>
        </svg>
        {!open && count > 0 && <span className="ann-toggle-badge">{count}</span>}
      </button>

      <div className="ann-drawer">
        <div className="ann-head">
          <div className="ann-head-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            <span className="ann-head-title">批注</span>
            <span className="ann-head-count">{count}</span>
          </div>
          <button className="ann-head-close" onClick={() => setOpen(false)} aria-label="收起批注面板">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>

        <div className="ann-list">
          {count === 0 && (
            <div className="ann-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              <p>暂无批注</p>
              <small>选中文本后点击工具栏的「💬 批注」即可添加</small>
            </div>
          )}

          {orderedAnnotations.map((ann) => (
            <article
              key={ann.id}
              ref={element => {
                if (element) cardRefs.current.set(ann.id, element);
                else cardRefs.current.delete(ann.id);
              }}
              className={`ann-card${editingId === ann.id ? ' is-editing' : ''}${activeId === ann.id ? ' is-active' : ''}`}
              onClick={() => selectAnnotation(ann)}
            >
              <header className="ann-card-head">
                <span className="ann-avatar" aria-hidden="true">批</span>
                <div className="ann-author">
                  <strong>我的批注</strong>
                  <time>{ann.createdAt}</time>
                </div>
                <div className="ann-card-menu">
                  <button
                    className="ann-more"
                    onClick={(event) => { event.stopPropagation(); setMenuId(menuId === ann.id ? null : ann.id); }}
                    aria-label="批注操作"
                    aria-expanded={menuId === ann.id}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
                  </button>
                  {menuId === ann.id && (
                    <div className="ann-menu-popover">
                      <button className="is-danger" onClick={() => removeAnnotation(ann.id)}>删除批注</button>
                    </div>
                  )}
                </div>
              </header>

              <button className="ann-quote" onClick={() => selectAnnotation(ann)} title="定位到原文">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                <span>{ann.quote.length > 80 ? ann.quote.slice(0, 80) + '…' : ann.quote}</span>
              </button>

              {editingId === ann.id ? (
                <div className="ann-edit" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                  <textarea
                    ref={editInputRef}
                    className="ann-edit-input"
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    placeholder="写下你的批注..."
                    rows={1}
                    onBlur={() => finishEdit(ann.id)}
                    onKeyDown={event => {
                      if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
                        event.preventDefault();
                        finishEdit(ann.id);
                      }
                    }}
                  />
                </div>
              ) : (
                <div
                  className="ann-body"
                  role="button"
                  tabIndex={0}
                  title="点击编辑批注"
                  onClick={event => {
                    event.stopPropagation();
                    startEdit(ann, getCaretOffsetAtPoint(event.currentTarget, event.clientX, event.clientY));
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      startEdit(ann);
                    }
                  }}
                >
                  {ann.text ? (
                    <p className="ann-text">{ann.text}</p>
                  ) : (
                    <p className="ann-text is-placeholder">空白批注，点击输入</p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export type { Annotation };
