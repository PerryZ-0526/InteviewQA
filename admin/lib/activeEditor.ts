import type { Editor } from '@tiptap/core';

let _active: Editor | null = null;
let _activeSection = '';
const _listeners = new Set<() => void>();

export function getActiveEditor(): Editor | null {
  return _active;
}

export function getActiveSection(): string {
  return _activeSection;
}

export function setActiveEditor(editor: Editor | null, sectionName?: string) {
  _active = editor;
  _activeSection = sectionName || '';
  _listeners.forEach((fn) => fn());
}

export function onChange(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
