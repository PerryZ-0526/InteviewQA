'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveEditor } from '@/lib/activeEditor';
import { mdToHtml } from '@/lib/markdown';

interface HistoryEntry {
  timestamp: string;
  instruction: string;
  selectedText: string;
  mode: string;
  thinkingEnabled: boolean;
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  thinkingOutput: string;
  resultOutput: string;
  error?: string;
}

export default function AIFloat() {
  const [showPopup, setShowPopup] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // ---- AI Popup state (same as EditorToolbar) ----
  const [aiStep, setAiStep] = useState<'input' | 'loading' | 'done'>('input');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiOriginal, setAiOriginal] = useState('');
  const [aiRewritten, setAiRewritten] = useState('');
  const [aiThinking, setAiThinking] = useState('');
  const [aiThinkingEnabled, setAiThinkingEnabled] = useState(false);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiMode, setAiMode] = useState<'replace' | 'answer'>('replace');
  const [aiTokens, setAiTokens] = useState({ in: 0, out: 0, ms: 0 });
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  const aiRangeRef = useRef<{ from: number; to: number } | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/rewrite/history?limit=50');
      const json = await res.json();
      if (json.success) setHistory(json.data || []);
    } catch {} finally { setLoadingHistory(false); }
  }, []);

  const openAiPopup = useCallback(() => {
    const editor = getActiveEditor();
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to);
    if (!text.trim()) return;
    aiRangeRef.current = { from, to };
    setAiOriginal(text);
    setAiInstruction('');
    setAiRewritten('');
    setAiThinking('');
    setAiStreaming(false);
    setAiMode('replace');
    setAiTokens({ in: 0, out: 0, ms: 0 });
    setAiStep('input');
    setShowPopup(true);
    setShowHistory(false);
    setTimeout(() => aiInputRef.current?.focus(), 50);
  }, []);

  const closePopup = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setShowPopup(false);
  }, []);

  const toggleHistory = () => {
    if (showHistory) { setShowHistory(false); return; }
    loadHistory();
    setShowHistory(true);
    setShowPopup(false);
  };

  const handleButtonClick = () => {
    const editor = getActiveEditor();
    if (!editor) { toggleHistory(); return; }
    const { from, to } = editor.state.selection;
    if (from !== to) { openAiPopup(); return; }
    toggleHistory();
  };

  const submitRewrite = useCallback(async () => {
    const editor = getActiveEditor();
    if (!editor || !aiInstruction.trim()) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiStep('loading');
    setAiRewritten('');
    setAiThinking('');
    setAiMode('replace');
    const range = aiRangeRef.current;
    if (!range) return;
    setAiStreaming(true);
    const { from, to } = range;
    const doc = editor.state.doc;
    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          instruction: aiInstruction,
          selectedText: aiOriginal,
          thinkingEnabled: aiThinkingEnabled,
          contextBefore: doc.textBetween(Math.max(0, from - 600), from).trim(),
          contextAfter: doc.textBetween(to, Math.min(doc.content.size, to + 600)).trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('浏览器无法读取流式响应');
      const decoder = new TextDecoder();
      let buffer = '';
      let result = '';
      let thinking = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'meta') {
              setAiMode(event.mode === 'answer' ? 'answer' : 'replace');
              setAiStep('done');
            } else if (event.type === 'thinking' && typeof event.text === 'string') {
              thinking += event.text;
              setAiThinking(thinking);
              setAiStep('done');
            } else if (event.type === 'text' && typeof event.text === 'string') {
              result += event.text;
              setAiRewritten(result);
              setAiStep('done');
            } else if (event.type === 'done') {
              setAiTokens({ in: event.inputTokens || 0, out: event.outputTokens || 0, ms: event.durationMs || 0 });
            } else if (event.type === 'error') {
              throw new Error(event.error || 'AI 响应中断');
            }
          } catch (error) {
            if (error instanceof SyntaxError) continue;
            throw error;
          }
        }
      }
      if (!result.trim()) throw new Error('AI 未返回有效内容');
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : '未知错误';
      alert('AI 助手失败: ' + message);
      setShowPopup(false);
    } finally {
      setAiStreaming(false);
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
    }
  }, [aiInstruction, aiOriginal, aiThinkingEnabled]);

  const acceptRewrite = useCallback(() => {
    const range = aiRangeRef.current;
    const editor = getActiveEditor();
    if (!editor || !range) return;
    editor.chain().focus().insertContentAt(range, mdToHtml(aiRewritten)).run();
    setShowPopup(false);
  }, [aiRewritten]);

  useEffect(() => () => aiAbortRef.current?.abort(), []);

  const fmtTime = (ts: string) => {
    try { return new Date(ts).toLocaleString('zh-CN'); } catch { return ts; }
  };

  return (
    <>
      <button
        className="ai-float"
        onClick={handleButtonClick}
        title="AI 助手"
        aria-label="AI 助手"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>

      {/* History panel */}
      {showHistory && (
        <div className="ai-history-overlay" onClick={() => setShowHistory(false)}>
          <div className="ai-history-panel" onClick={e => e.stopPropagation()}>
            <div className="ai-history-head">
              <h3>AI 助手历史记录</h3>
              <button onClick={() => setShowHistory(false)}>×</button>
            </div>
            <div className="ai-history-body">
              {loadingHistory ? (
                <div className="loading-spinner" style={{ margin: '20px auto' }} />
              ) : history.length === 0 ? (
                <p className="muted" style={{ textAlign: 'center', padding: 20 }}>暂无记录</p>
              ) : (
                history.map((entry, i) => (
                  <div key={i} className="ai-history-card">
                    <div className="ai-history-meta" onClick={() => setExpandedId(expandedId === i ? null : i)}>
                      <span className="ai-history-time">{fmtTime(entry.timestamp)}</span>
                      <span className="ai-history-mode">{entry.mode === 'answer' ? '问答' : '改写'}{entry.thinkingEnabled ? ' · 深度思考' : ''}</span>
                      <span>{entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : ''}</span>
                      <span>{entry.inputTokens + entry.outputTokens > 0 ? `${entry.inputTokens}+${entry.outputTokens} tk` : ''}</span>
                      {entry.error && <span style={{ color: '#e03131' }}>失败</span>}
                    </div>
                    {expandedId === i && (
                      <div className="ai-history-detail">
                        <div className="ai-history-section"><strong>选中文本：</strong><span>{entry.selectedText.slice(0, 200)}</span></div>
                        <div className="ai-history-section"><strong>指令：</strong><span>{entry.instruction}</span></div>
                        {entry.thinkingOutput && (
                          <details className="ai-history-thinking">
                            <summary>思考过程</summary>
                            <pre>{entry.thinkingOutput}</pre>
                          </details>
                        )}
                        <div className="ai-history-section"><strong>输出：</strong><div className="ai-history-output md" dangerouslySetInnerHTML={{ __html: (entry.resultOutput || entry.error || '') }} /></div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Popup */}
      {showPopup && (
        <div className="ai-popup-overlay" onClick={closePopup}>
          <div className="ai-popup" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="ai-popup-header">
              <div className="ai-popup-brand">
                <span className="ai-popup-mark">✦</span>
                <div>
                  <div className="ai-popup-title">AI 助手</div>
                  <div className="ai-popup-subtitle">围绕当前选区改写、解释或提问</div>
                </div>
              </div>
              <button type="button" className="ai-popup-close" onClick={closePopup}>×</button>
            </div>
            <div className="ai-popup-body">
              {aiStep === 'input' && (<>
                <section className="ai-selection-card">
                  <div className="ai-section-label"><span>选区</span><span>{aiOriginal.length} 字</span></div>
                  <div className="ai-popup-original">{aiOriginal.slice(0, 320)}{aiOriginal.length > 320 ? '…' : ''}</div>
                </section>
                <section className="ai-prompt-section">
                  <label className="ai-section-label" htmlFor="ai-instruction-float">告诉 AI 你想做什么</label>
                  <textarea id="ai-instruction-float" ref={aiInputRef} className="ai-prompt-input" rows={3} placeholder="例如：改得更专业；解释这段话；这个结论成立吗？" value={aiInstruction} onChange={e => setAiInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitRewrite(); }} />
                </section>
                <section className="ai-mode-section" aria-label="响应模式">
                  <button type="button" className={`ai-mode-option${!aiThinkingEnabled ? ' active' : ''}`} aria-pressed={!aiThinkingEnabled} onClick={() => setAiThinkingEnabled(false)}>
                    <span className="ai-mode-icon">↗</span><span><strong>快速</strong><small>直接生成</small></span>
                  </button>
                  <button type="button" className={`ai-mode-option${aiThinkingEnabled ? ' active' : ''}`} aria-pressed={aiThinkingEnabled} onClick={() => setAiThinkingEnabled(true)}>
                    <span className="ai-mode-icon">◇</span><span><strong>深度思考</strong><small>先推理</small></span>
                  </button>
                </section>
                <div className="ai-popup-actions ai-input-actions">
                  <span className="ai-shortcut-hint">Ctrl / ⌘ + Enter</span>
                  <button type="button" className="ai-send-button" onClick={submitRewrite} disabled={!aiInstruction.trim()}>发送 <span>↵</span></button>
                </div>
              </>)}
              {aiStep === 'loading' && (
                <div className="ai-popup-loading">
                  <div className="ai-loading-mark">✦</div>
                  <div><strong>正在处理…</strong></div>
                </div>
              )}
              {aiStep === 'done' && (<>
                <div className="ai-result-heading">
                  <div>
                    <span className="ai-result-kicker">{aiMode === 'replace' ? '编辑建议' : '问题解答'}</span>
                    <h3>{aiMode === 'replace' ? '修改后' : '回答'}</h3>
                  </div>
                  {aiStreaming && <span className="ai-live-status"><i />生成中</span>}
                </div>
                <div className="ai-compare">
                  {aiThinkingEnabled && (
                    <details className="ai-thinking-panel" open>
                      <summary><span>思考过程</span></summary>
                      <div className="ai-thinking-text">{aiThinking || '…'}</div>
                    </details>
                  )}
                  {aiMode === 'replace' && <div className="ai-result-block muted"><div className="ai-compare-label">原文</div><div className="ai-compare-text original">{aiOriginal}</div></div>}
                  <div className="ai-result-block primary"><div className="ai-compare-label">{aiMode === 'replace' ? '修改后' : '回答'}</div><div className="ai-compare-text rewritten" aria-live="polite">{aiRewritten || '…'}</div></div>
                </div>
                {(aiTokens.in + aiTokens.out > 0) && (
                  <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                    {aiTokens.in}+{aiTokens.out} tokens · {(aiTokens.ms / 1000).toFixed(1)}s
                  </div>
                )}
                <div className="ai-popup-actions ai-result-actions">
                  <button type="button" className="ai-text-button" onClick={() => { aiAbortRef.current?.abort(); setAiInstruction(''); setAiRewritten(''); setAiThinking(''); setAiStreaming(false); setAiStep('input'); setTimeout(() => aiInputRef.current?.focus(), 50); }}>重新提问</button>
                  <div>
                    <button type="button" className="ai-secondary-button" onClick={closePopup}>{aiMode === 'replace' ? '放弃' : '完成'}</button>
                    {aiMode === 'replace' && <button type="button" className="ai-send-button" onClick={acceptRewrite} disabled={!aiRewritten.trim() || aiStreaming}>替换原文</button>}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
