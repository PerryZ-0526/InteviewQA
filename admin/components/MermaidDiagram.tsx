'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Code2, Copy, Maximize2, X } from 'lucide-react';

type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string };

let mermaidModule: Promise<typeof import('mermaid')> | null = null;
let mermaidInitialized = false;
let diagramSequence = 0;

async function loadMermaid() {
  mermaidModule ??= import('mermaid');
  const { default: mermaid } = await mermaidModule;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: {
        primaryColor: '#f2eef8',
        primaryTextColor: '#302a39',
        primaryBorderColor: '#8a79a8',
        secondaryColor: '#eef5f0',
        tertiaryColor: '#f8f7fa',
        lineColor: '#716a79',
        actorBkg: '#f2eef8',
        actorBorder: '#8a79a8',
        actorTextColor: '#302a39',
        signalColor: '#62586e',
        signalTextColor: '#302a39',
        noteBkgColor: '#fff7dc',
        noteBorderColor: '#d7b95f',
      },
      flowchart: { htmlLabels: false, useMaxWidth: true },
      sequence: { useMaxWidth: true },
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '请检查 Mermaid 语法';
  const firstLine = error.message.split('\n').find((line) => line.trim());
  return firstLine?.trim() || '请检查 Mermaid 语法';
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

interface Props {
  chart: string;
  compact?: boolean;
  sourceEditor?: ReactNode;
}

export default function MermaidDiagram({ chart, compact = false, sourceEditor }: Props) {
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const source = chart.trim();
    if (!source) {
      setState({ status: 'error', message: '图表内容为空' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `mermaid-diagram-${++diagramSequence}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setState({ status: 'ready', svg });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      }
    }, compact ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chart, compact]);

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
    if (await writeClipboard(chart)) {
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } else {
      setCopied(false);
    }
  };

  const sourceVisible = sourceOpen || state.status === 'error';
  const canvas = state.status === 'ready' ? (
    <div
      className="mermaid-canvas"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  ) : (
    <div
      className={`mermaid-canvas${state.status === 'error' ? ' mermaid-canvas-error' : ''}`}
      aria-busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <div className="mermaid-skeleton" aria-label="正在渲染图表">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="mermaid-error-message" role="alert">
          <strong>Mermaid 图表无法渲染</strong>
          <span>{state.message}</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <figure className={`mermaid-diagram${compact ? ' mermaid-diagram-compact' : ''}`}>
        <div className="mermaid-diagram-toolbar" contentEditable={false}>
          <figcaption>Mermaid</figcaption>
          <div className="mermaid-diagram-actions">
            <button
              type="button"
              className={sourceVisible ? 'active' : ''}
              aria-label={sourceVisible ? '收起 Mermaid 源码' : '查看 Mermaid 源码'}
              aria-pressed={sourceVisible}
              title={sourceVisible ? '收起源码' : '查看源码'}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                setSourceOpen((open) => !open);
              }}
            >
              <Code2 size={15} />
            </button>
            <button
              type="button"
              aria-label={copied ? '已复制 Mermaid 源码' : '复制 Mermaid 源码'}
              title={copied ? '已复制' : '复制源码'}
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
              aria-label="全屏查看 Mermaid 图表"
              title="全屏查看"
              disabled={state.status !== 'ready'}
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
        <div className="mermaid-diagram-body" contentEditable={false}>
          {canvas}
        </div>
        <div
          className="mermaid-source-panel"
          data-open={sourceVisible}
          hidden={!sourceVisible}
        >
          {sourceEditor || <pre><code>{chart}</code></pre>}
        </div>
      </figure>

      {fullscreen && state.status === 'ready'
        ? createPortal(
            <div className="mermaid-fullscreen" role="dialog" aria-modal="true" aria-label="Mermaid 图表全屏预览">
              <div className="mermaid-fullscreen-toolbar">
                <span>Mermaid</span>
                <button
                  type="button"
                  aria-label="退出全屏"
                  title="退出全屏"
                  onClick={() => setFullscreen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div
                className="mermaid-fullscreen-canvas"
                dangerouslySetInnerHTML={{ __html: state.svg }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
