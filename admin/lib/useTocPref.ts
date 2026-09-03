// 目录显示偏好：按文档独立记忆「目录是否隐藏」，localStorage 持久化
// 题目编辑（DocumentEditor）、项目文档（ProjectDocumentView）、外部文档（ExternalDocView）三个视图共用

'use client';

import { useCallback, useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'interviewqa:toc-prefs';

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
