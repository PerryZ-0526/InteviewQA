'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 手写 pointer 拖拽（不引入依赖库）：侧边栏分类题目 → 分类区块的拖拽移动。
// 视觉：幽灵跟随（直接改 DOM，不触发 React 渲染）、落点指示线、目标分类高亮、
// 折叠分类悬停自动展开、边缘自动滚动、Esc/无效落点取消、释放后 FLIP 列表动画。

export interface SidebarDragItem {
  category: string;
  filename: string;
  title: string;
  chip: string; // 序号，如 "004"
  originalIndex: number; // 该行在源分类列表中的下标（移除后列表的 no-op 判定基准）
}

export interface SidebarDropTarget {
  category: string;
  toIndex: number; // 「移除被拖行后」目标列表中的插入下标
  indicatorTop: number; // 指示线相对目标分类 wrapper 的 top（随滚动同步，无需换算）
}

export interface SidebarDragState {
  phase: 'idle' | 'dragging' | 'dropping' | 'cancelling';
  item: SidebarDragItem | null;
  ghost: { x: number; y: number } | null;
  drop: SidebarDropTarget | null;
}

export interface FlipBefore {
  before: Map<string, DOMRect>; // `${cat}:${filename}` → 拖放前 rect
  insertKey: string | null; // 被插入行（移动后）的 key，用于 drop-in 动画
}

export interface SidebarDragHandlers {
  state: SidebarDragState;
  ghostRef: React.MutableRefObject<HTMLDivElement | null>;
  flipBeforeRef: React.MutableRefObject<FlipBefore | null>;
  suppressClickRef: React.MutableRefObject<boolean>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

interface DragSession {
  item: SidebarDragItem;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  started: boolean;
  scrollEl: HTMLElement;
  raf: number;
  expandTimer: number | null;
  hoverSlug: string | null;
  lastDropKey: string | null;
  lastIndicatorTop: number | null;
  lastDrop: SidebarDropTarget | null;
  cleanup: (() => void) | null;
}

const THRESHOLD_PX = 4;
const EDGE_MARGIN = 40;
const MAX_EDGE_SPEED = 12; // px/帧
const AUTO_EXPAND_DELAY = 500;

const ROW_SELECTOR = '[data-sidebar-draggable]';
const CAT_SELECTOR = '[data-sidebar-cat]';

export function useSidebarDrag(opts: {
  onMoveQuestion: (fromCat: string, filename: string, toCat: string, toIndex: number) => void;
  onExpandCategory: (slug: string) => void;
}): SidebarDragHandlers {
  const { onMoveQuestion, onExpandCategory } = opts;
  const [state, setState] = useState<SidebarDragState>({ phase: 'idle', item: null, ghost: null, drop: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const flipBeforeRef = useRef<FlipBefore | null>(null);
  const suppressClickRef = useRef(false);
  const sessionRef = useRef<DragSession | null>(null);
  const onMoveRef = useRef(onMoveQuestion);
  onMoveRef.current = onMoveQuestion;
  const onExpandRef = useRef(onExpandCategory);
  onExpandRef.current = onExpandCategory;

  // 组件卸载时兜底清理（避免拖到一半页面刷新/卸载残留全局监听）
  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s) {
        cancelAnimationFrame(s.raf);
        if (s.expandTimer) clearTimeout(s.expandTimer);
        s.cleanup?.();
        document.body.classList.remove('sidebar-dragging');
      }
    };
  }, []);

  // 拖拽结束后紧随的 click（可能落在任意区域：标签、project 行等）需全局抑制。
  // 常驻挂载：click 在 pointerup 之后才派发，监听器必须比拖拽会话活得久，靠标志位判断。
  useEffect(() => {
    const suppressClick = (ev: MouseEvent) => {
      if (suppressClickRef.current) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    document.addEventListener('click', suppressClick, true);
    return () => document.removeEventListener('click', suppressClick, true);
  }, []);

  /** 命中测试：指针所在分类 + 插入槽位（排除被拖行 → 语义为「移除后列表」） */
  const computeDrop = (s: DragSession): SidebarDropTarget | null => {
    const wrappers = Array.from(s.scrollEl.querySelectorAll<HTMLElement>(CAT_SELECTOR));
    let target: HTMLElement | null = null;
    let nearest: { el: HTMLElement; dist: number } | null = null;
    for (const w of wrappers) {
      const r = w.getBoundingClientRect();
      if (s.pointerY >= r.top && s.pointerY <= r.bottom) { target = w; break; }
      const dist = s.pointerY < r.top ? r.top - s.pointerY : s.pointerY - r.bottom;
      if (!nearest || dist < nearest.dist) nearest = { el: w, dist };
    }
    if (!target) {
      if (nearest && nearest.dist <= 60) target = nearest.el;
      else return null;
    }
    const wRect = target.getBoundingClientRect();
    const rows = Array.from(target.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
      (r) => !(r.dataset.catSlug === s.item.category && r.dataset.filename === s.item.filename),
    );
    let toIndex = rows.length;
    let indicatorTop = rows.length > 0 ? rows[rows.length - 1].getBoundingClientRect().bottom - wRect.top : 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (s.pointerY < r.top + r.height / 2) { toIndex = i; indicatorTop = r.top - wRect.top; break; }
    }
    // 同分类且落点等于原位 → 视为无效落点（释放时按取消处理，不显示指示线）
    if (target.dataset.sidebarCat === s.item.category && toIndex === s.item.originalIndex) return null;
    return { category: target.dataset.sidebarCat!, toIndex, indicatorTop };
  };

  /** 悬停折叠分类（无行）500ms 后自动展开 */
  const autoExpand = (s: DragSession) => {
    const wrappers = Array.from(s.scrollEl.querySelectorAll<HTMLElement>(CAT_SELECTOR));
    const hover = wrappers.find((w) => {
      const r = w.getBoundingClientRect();
      return s.pointerY >= r.top && s.pointerY <= r.bottom;
    });
    const slug = hover?.dataset.sidebarCat ?? null;
    if (slug === s.hoverSlug) return;
    s.hoverSlug = slug;
    if (s.expandTimer) { clearTimeout(s.expandTimer); s.expandTimer = null; }
    if (slug && hover && !hover.querySelector(ROW_SELECTOR)) {
      s.expandTimer = window.setTimeout(() => {
        onExpandRef.current(slug);
        s.expandTimer = null;
      }, AUTO_EXPAND_DELAY);
    }
  };

  const startLoop = (s: DragSession) => {
    const loop = () => {
      const el = s.scrollEl;
      const rect = el.getBoundingClientRect();
      // 1. 边缘自动滚动（速度随接近程度线性增大）
      if (el.scrollHeight > el.clientHeight) {
        if (s.pointerY < rect.top + EDGE_MARGIN && el.scrollTop > 0) {
          el.scrollTop -= MAX_EDGE_SPEED * (1 - Math.max(0, s.pointerY - rect.top) / EDGE_MARGIN);
        } else if (s.pointerY > rect.bottom - EDGE_MARGIN && el.scrollTop < el.scrollHeight - el.clientHeight) {
          el.scrollTop += MAX_EDGE_SPEED * (1 - Math.max(0, rect.bottom - s.pointerY) / EDGE_MARGIN);
        }
      }
      // 2. 幽灵跟随（直接改 DOM，避免每帧触发大组件重渲染）
      const ghost = ghostRef.current;
      if (ghost) ghost.style.transform = `translate3d(${s.pointerX}px, ${s.pointerY}px, 0) scale(1.04)`;
      // 3. 命中测试 + 自动展开，仅在结果变化时更新 React 状态
      autoExpand(s);
      const drop = computeDrop(s);
      const key = drop ? `${drop.category}:${drop.toIndex}` : null;
      if (key !== s.lastDropKey || (drop && drop.indicatorTop !== s.lastIndicatorTop)) {
        s.lastDropKey = key;
        s.lastIndicatorTop = drop ? drop.indicatorTop : null;
        s.lastDrop = drop;
        setState((prev) => ({ ...prev, drop }));
      }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
  };

  /** 捕获 FLIP 前 rects（源/目标两个分类的行） */
  const captureFlipBefore = (s: DragSession, drop: SidebarDropTarget): FlipBefore => {
    const before = new Map<string, DOMRect>();
    for (const slug of new Set([s.item.category, drop.category])) {
      const w = s.scrollEl.querySelector<HTMLElement>(`${CAT_SELECTOR}[data-sidebar-cat="${CSS.escape(slug)}"]`);
      if (!w) continue;
      for (const r of Array.from(w.querySelectorAll<HTMLElement>(ROW_SELECTOR))) {
        before.set(`${r.dataset.catSlug}:${r.dataset.filename}`, r.getBoundingClientRect());
      }
    }
    return { before, insertKey: `${drop.category}:${s.item.filename}` };
  };

  const endDrag = useCallback((mode: 'drop' | 'cancel', drop?: SidebarDropTarget | null) => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    cancelAnimationFrame(s.raf);
    if (s.expandTimer) { clearTimeout(s.expandTimer); s.expandTimer = null; }
    s.cleanup?.();
    document.body.classList.remove('sidebar-dragging');
    // 释放后的 click 事件可能落在拖拽起点的行上：等 click 派发完成后再复位抑制标记
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);

    const ghost = ghostRef.current;
    if (!ghost) {
      setState({ phase: 'idle', item: null, ghost: null, drop: null });
      return;
    }
    if (mode === 'drop' && drop) {
      // 幽灵落进槽位：缩放到 1 并移到指示线位置，淡出
      const w = s.scrollEl.querySelector<HTMLElement>(`${CAT_SELECTOR}[data-sidebar-cat="${CSS.escape(drop.category)}"]`);
      const wTop = w?.getBoundingClientRect().top ?? s.pointerY;
      ghost.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
      ghost.style.transform = `translate3d(${s.pointerX}px, ${wTop + drop.indicatorTop - 8}px, 0) scale(1)`;
      ghost.style.opacity = '0';
      setState({ phase: 'dropping', item: stateRef.current.item, ghost: stateRef.current.ghost, drop: null });
      window.setTimeout(() => setState({ phase: 'idle', item: null, ghost: null, drop: null }), 160);
    } else {
      ghost.style.transition = 'opacity 0.12s ease';
      ghost.style.opacity = '0';
      setState({ phase: 'cancelling', item: stateRef.current.item, ghost: stateRef.current.ghost, drop: null });
      window.setTimeout(() => setState({ phase: 'idle', item: null, ghost: null, drop: null }), 130);
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const row = (e.target as Element).closest<HTMLElement>(ROW_SELECTOR);
    if (!row) return;
    const scrollEl = row.closest('.sidebar') as HTMLElement | null;
    if (!scrollEl || sessionRef.current) return;

    const category = row.dataset.catSlug!;
    const filename = row.dataset.filename!;
    const siblings = Array.from(row.parentElement!.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    const s: DragSession = {
      item: {
        category,
        filename,
        title: row.dataset.title || filename,
        chip: filename.slice(0, 3),
        originalIndex: siblings.indexOf(row),
      },
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      started: false,
      scrollEl,
      raf: 0,
      expandTimer: null,
      hoverSlug: null,
      lastDropKey: null,
      lastIndicatorTop: null,
      lastDrop: null,
      cleanup: null,
    };
    sessionRef.current = s;
    e.preventDefault(); // 阻止按钮聚焦与文本选择

    const onMove = (ev: PointerEvent) => {
      s.pointerX = ev.clientX;
      s.pointerY = ev.clientY;
      if (!s.started) {
        if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < THRESHOLD_PX) return;
        s.started = true;
        suppressClickRef.current = true;
        document.body.classList.add('sidebar-dragging');
        setState({ phase: 'dragging', item: s.item, ghost: { x: ev.clientX, y: ev.clientY }, drop: null });
        startLoop(s);
      }
    };
    const finish = () => {
      if (!s.started) { endDrag('cancel'); return; } // 未过阈值：正常点击
      const drop = s.lastDrop;
      if (drop) {
        flipBeforeRef.current = captureFlipBefore(s, drop);
        onMoveRef.current(s.item.category, s.item.filename, drop.category, drop.toIndex);
        endDrag('drop', drop);
      } else {
        endDrag('cancel');
      }
    };
    const onCancel = () => { if (s.started) endDrag('cancel'); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && s.started) endDrag('cancel'); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    s.cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [endDrag]);

  return {
    state,
    ghostRef,
    flipBeforeRef,
    suppressClickRef,
    onPointerDown,
  };
}
