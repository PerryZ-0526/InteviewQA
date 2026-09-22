// 文档视图偏好：按文档独立记忆目录显隐与分类文档渲染模式，localStorage 持久化
// 目录偏好由题目、项目、外部文档共用；渲染模式仅供分类题目使用

'use client';

import { useCallback, useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'interviewqa:toc-prefs';
const CATEGORY_RENDER_MODE_STORAGE_KEY = 'interviewqa:category-render-mode-prefs';

export type CategoryRenderMode = 'sectioned' | 'continuous';

/** 读取全部文档的偏好表（docKey -> 目录是否显示），localStorage 不可用时返回空对象 */
function readAll(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** 写回单个文档的目录显示状态，localStorage 不可用时静默降级 */
function writePref(docKey: string, show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readAll();
    all[docKey] = show;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅本次会话生效
  }
}

/**
 * 按文档记忆目录显示状态。
 * 初始值 true 与服务端渲染保持一致，避免 hydration 不匹配；
 * 客户端在绘制前（useLayoutEffect）按 docKey 恢复偏好，避免目录"先闪现再隐藏"；
 * 切换后立即写入 localStorage，下次打开同一文档时保持上次的隐藏/展开状态。
 */
export function useTocPref(docKey: string) {
  const [showToc, setShowToc] = useState(true);

  useLayoutEffect(() => {
    setShowToc(readAll()[docKey] !== false);
  }, [docKey]);

  const toggleToc = useCallback(() => {
    setShowToc((prev) => {
      const next = !prev;
      // writePref 幂等，StrictMode 下 updater 双调用也安全
      writePref(docKey, next);
      return next;
    });
  }, [docKey]);

  return { showToc, toggleToc };
}

/** 读取分类文档的渲染模式偏好；未配置或数据无效时默认分段渲染 */
function readCategoryRenderModes(): Record<string, CategoryRenderMode> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CATEGORY_RENDER_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, CategoryRenderMode] =>
        entry[1] === 'sectioned' || entry[1] === 'continuous'
      ),
    );
  } catch {
    return {};
  }
}

function writeCategoryRenderMode(docKey: string, mode: CategoryRenderMode): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readCategoryRenderModes();
    all[docKey] = mode;
    window.localStorage.setItem(CATEGORY_RENDER_MODE_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage 不可用时静默降级为仅本次会话生效
  }
}

/** 分类文档渲染模式：按文档记忆，默认保持原有的分段编辑方式 */
export function useCategoryRenderMode(docKey: string) {
  const [renderMode, setRenderMode] = useState<CategoryRenderMode>('sectioned');

  useLayoutEffect(() => {
    setRenderMode(readCategoryRenderModes()[docKey] || 'sectioned');
  }, [docKey]);

  const toggleRenderMode = useCallback(() => {
    setRenderMode((previous) => {
      const next = previous === 'sectioned' ? 'continuous' : 'sectioned';
      writeCategoryRenderMode(docKey, next);
      return next;
    });
  }, [docKey]);

  return { renderMode, toggleRenderMode };
}
