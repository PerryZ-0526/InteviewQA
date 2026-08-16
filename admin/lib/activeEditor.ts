import type { Editor } from '@tiptap/core';

let _active: Editor | null = null;
let _activeSection = '';
let _activeUploadDir = '';
const _listeners = new Set<() => void>();

export function getActiveEditor(): Editor | null {
  return _active;
}

export function getActiveSection(): string {
  return _activeSection;
}

// 当前激活编辑器所属文档的仓库内目录（如 categories/agent），用于图片上传定位
export function getActiveUploadDir(): string {
  return _activeUploadDir;
}

export function setActiveEditor(editor: Editor | null, sectionName?: string, uploadDir?: string) {
  _active = editor;
  _activeSection = sectionName || '';
  _activeUploadDir = uploadDir || '';
  _listeners.forEach((fn) => fn());
}

export function onChange(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
