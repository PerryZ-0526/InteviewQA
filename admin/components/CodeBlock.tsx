'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Maximize2, X } from 'lucide-react';
import { writeClipboard } from '@/lib/clipboard';

interface Props {
  source: string;
  language?: string;
  languageControl?: ReactNode;
  sourceEditor?: ReactNode;
}

export default function CodeBlock({
  source,
  language = 'text',
  languageControl,
  sourceEditor,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const normalizedLanguage = language.trim() || 'text';

  useEffect(() => {
    if (!fullscreen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [fullscreen]);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  const copySource = async () => {
    if (!await writeClipboard(source)) return;
    setCopied(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <figure className="code-panel">
        <div className="code-panel-toolbar" contentEditable={false}>
          {languageControl || <figcaption>{normalizedLanguage}</figcaption>}
          <div className="code-panel-actions">
            <button
              type="button"
              aria-label={copied ? '已复制代码' : '复制代码'}
              title={copied ? '已复制' : '复制代码'}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                void copySource();
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button
              type="button"
              aria-label="全屏查看代码"
              title="全屏查看"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                setFullscreen(true);
              }}
            >
              <Maximize2 size={15} />
            </button>
          </div>
        </div>
        <div className="code-panel-body">
          {sourceEditor || (
            <pre>
              <code className={`language-${normalizedLanguage}`}>{source}</code>
            </pre>
          )}
        </div>
      </figure>

      {fullscreen
        ? createPortal(
            <div className="code-fullscreen" role="dialog" aria-modal="true" aria-label="代码全屏预览">
              <div className="code-fullscreen-toolbar">
                <span>{normalizedLanguage}</span>
                <button
                  type="button"
                  aria-label="退出全屏"
                  title="退出全屏"
                  onClick={() => setFullscreen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="code-fullscreen-body">
                <pre><code className={`language-${normalizedLanguage}`}>{source}</code></pre>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
