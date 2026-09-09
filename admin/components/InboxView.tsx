'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeQuestionText } from '@/lib/normalize';

interface InboxQuestion {
  text: string;
  checked: boolean;
}

interface InboxBatch {
  time: string;
  questions: InboxQuestion[];
}

interface Props {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * 待入库题单编辑页：
 * 上方输入栏支持多题目输入（按换行拆题），下方按批次倒序展示历史题目（最新批次在最上），
 * 全批次题目统一连续编号；每题右侧提供勾选框（标记已入库）、复制与删除按钮，
 * 题目文本可直接点击进入行内编辑。
 */
export default function InboxView({ onToast }: Props) {
  const [batches, setBatches] = useState<InboxBatch[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  // 复制成功的题目 key（`${批次下标}-${题目下标}`），1.5s 内按钮显示为对勾
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // 正在编辑的题目 key 与其编辑框内容
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  // 编辑防抖定时器：输入即保存，停顿片刻后自动落盘
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PUT 串行链：按触发顺序落盘，避免快速连续操作时慢的旧请求后到覆盖新状态
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());

  // 输入框按行拆题（去首尾空白、去空行）
  const parsedQuestions = input.split('\n').map((s) => s.trim()).filter(Boolean);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      const json = await res.json();
      if (json.success) setBatches(json.data?.batches || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadInbox();
    // 组件卸载时清理编辑防抖定时器，避免内存泄漏
    return () => {
      if (editTimerRef.current) clearTimeout(editTimerRef.current);
    };
  }, [loadInbox]);

  // 题单内容变化时通知侧边栏刷新待处理徽标
  const notifySidebar = () => window.dispatchEvent(new CustomEvent('inbox-changed'));

  const addQuestions = async () => {
    if (parsedQuestions.length === 0 || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: parsedQuestions }),
      });
      const json = await res.json();
      if (json.success) {
        setBatches(json.data?.batches || []);
        setInput('');
        onToast?.(`已加入 ${json.data?.added ?? parsedQuestions.length} 道题`, 'success');
        notifySidebar();
      } else {
        onToast?.(json.error || '加入失败', 'error');
      }
    } catch {
      onToast?.('网络错误，请重试', 'error');
    }
    setAdding(false);
  };

  // 串行落盘：把 next 状态乐观更新到界面并写入服务端，失败时回滚为 prev 并提示
  const persistBatches = (prev: InboxBatch[], next: InboxBatch[], failMsg: string) => {
    setBatches(next);
    notifySidebar();
    const run = writeChainRef.current.then(async () => {
      const res = await fetch('/api/inbox', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batches: next }),
      });
      if (!res.ok) throw new Error('save failed');
    });
    writeChainRef.current = run.catch(() => {
      setBatches(prev);
      onToast?.(failMsg, 'error');
    });
  };

  const toggleChecked = (batchIndex: number, questionIndex: number) => {
    const prev = batches;
    // 乐观更新：先翻转界面状态，再串行落盘，失败时回滚
    const next = prev.map((b, bi) =>
      bi === batchIndex
        ? { ...b, questions: b.questions.map((q, qi) => (qi === questionIndex ? { ...q, checked: !q.checked } : q)) }
        : b
    );
    persistBatches(prev, next, '勾选状态保存失败，已回滚');
  };

  // 进入编辑态：取消可能存在的未落盘防抖任务，记录题目 key 并把原文本填入编辑框
  const startEdit = (key: string, text: string) => {
    if (editTimerRef.current) {
      clearTimeout(editTimerRef.current);
      editTimerRef.current = null;
    }
    setEditingKey(key);
    setEditingText(text);
  };

  // 把编辑中的文本写入本地状态并落盘（先做标点/空格归一化，与服务端保持一致；空文本跳过）
  const applyEditText = (batchIndex: number, questionIndex: number, raw: string) => {
    const text = normalizeQuestionText(raw);
    if (!text) return;
    const prev = batches;
    const next = prev.map((b, bi) =>
      bi === batchIndex
        ? { ...b, questions: b.questions.map((q, qi) => (qi === questionIndex ? { ...q, text } : q)) }
        : b
    );
    persistBatches(prev, next, '题目修改保存失败，已回滚');
  };

  // 输入即保存：更新编辑框内容，停顿 600ms 后自动落盘
  const onEditTextChange = (batchIndex: number, questionIndex: number, value: string) => {
    setEditingText(value);
    if (editTimerRef.current) clearTimeout(editTimerRef.current);
    editTimerRef.current = setTimeout(() => {
      editTimerRef.current = null;
      applyEditText(batchIndex, questionIndex, value);
    }, 600);
  };

  // 结束编辑态：立即落盘剩余输入（Enter/Esc/失焦均走这里，Esc 不做撤销——输入即已保存）
  const finishEdit = (batchIndex: number, questionIndex: number) => {
    if (editTimerRef.current) {
      clearTimeout(editTimerRef.current);
      editTimerRef.current = null;
    }
    setEditingKey(null);
    applyEditText(batchIndex, questionIndex, editingText);
  };

  // 删除题目：批次被删空时本地直接丢弃该批次（与后端 PUT 归一化行为一致，避免残留空批次卡片）
  const deleteQuestion = (batchIndex: number, questionIndex: number) => {
    const prev = batches;
    const next = prev
      .map((b, bi) =>
        bi === batchIndex ? { ...b, questions: b.questions.filter((_, qi) => qi !== questionIndex) } : b
      )
      .filter((b) => b.questions.length > 0);
    if (editingKey !== null) setEditingKey(null);
    persistBatches(prev, next, '题目删除失败，已回滚');
    onToast?.('已删除该题目', 'success');
  };

  const copyQuestion = async (text: string, key: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 非安全上下文（http 局域网访问）下 clipboard API 不可用，退回 execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } else {
      onToast?.('复制失败', 'error');
    }
  };

  // 全局统一编号：批次按入库时间正序累计起始序号（题目序号在全题单内连续）
  let counter = 0;
  const numbered = batches.map((b) => {
    const start = counter + 1;
    counter += b.questions.length;
    return { ...b, start };
  });
  // 展示时批次倒排：最新的一批在最上方
  const display = numbered.map((b, idx) => ({ ...b, origIndex: idx })).reverse();

  const totalUnchecked = batches.reduce(
    (sum, b) => sum + b.questions.filter((q) => !q.checked).length,
    0
  );

  return (
    <div className="inbox-view">
      {/* 输入区：多行输入，每行一道题 */}
      <div className="card inbox-input-card">
        <div className="inbox-input-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          <span>收集面试题</span>
          {counter > 0 && (
            <span className="inbox-summary">共 {counter} 题 · 待处理 {totalUnchecked} 题</span>
          )}
        </div>
        <textarea
          className="form-textarea inbox-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              addQuestions();
            }
          }}
          placeholder={'粘贴或输入面试题，每行一道，例如：\n聊聊 Redis 的持久化机制\nJVM 有哪些垃圾回收器，怎么选型？'}
          autoFocus
          spellCheck={false}
          disabled={adding}
        />
        <div className="inbox-input-footer">
          <span className="inbox-hint">按换行拆分为多道题目 · Ctrl/⌘ + Enter 快速加入</span>
          <button
            className="btn btn-primary"
            onClick={addQuestions}
            disabled={adding || parsedQuestions.length === 0}
          >
            {adding ? '加入中...' : parsedQuestions.length > 0 ? `加入题单（${parsedQuestions.length} 题）` : '加入题单'}
          </button>
        </div>
      </div>

      {/* 批次列表：最新批次在最上方，题目序号全批次统一连续 */}
      {loading ? (
        <div className="loading-overlay" style={{ padding: 40 }}>
          <div className="loading-spinner" />
        </div>
      ) : display.length === 0 ? (
        <div className="empty-state">
          <h3>暂无待入库题目</h3>
          <p>在上方输入框粘贴面试题（每行一道），点击「加入题单」开始收集</p>
        </div>
      ) : (
        display.map((batch) => (
          <div className="card inbox-batch-card" key={`${batch.origIndex}-${batch.time}`}>
            <div className="inbox-batch-header">
              <span className="inbox-batch-time">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {batch.time}
              </span>
              <span className="inbox-batch-count">
                {batch.questions.every((q) => q.checked)
                  ? `${batch.questions.length} 题 · 已全部入库`
                  : `${batch.questions.length} 题`}
              </span>
            </div>
            {batch.questions.map((q, qi) => {
              const key = `${batch.origIndex}-${qi}`;
              const copied = copiedKey === key;
              const editing = editingKey === key;
              // 编辑态：文本替换为行内输入框，输入即保存，失焦/Enter/Esc 结束编辑
              if (editing) {
                return (
                  <div className="inbox-question editing" key={key}>
                    <span className="inbox-question-index">{batch.start + qi}</span>
                    <input
                      className="inbox-edit-input"
                      value={editingText}
                      onChange={(e) => onEditTextChange(batch.origIndex, qi, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          e.preventDefault();
                          // 触发 blur，由统一的失焦逻辑立即落盘并退出编辑
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      onBlur={() => finishEdit(batch.origIndex, qi)}
                      autoFocus
                      spellCheck={false}
                    />
                  </div>
                );
              }
              return (
                <div className={`inbox-question${q.checked ? ' done' : ''}`} key={key}>
                  <span className="inbox-question-index">{batch.start + qi}</span>
                  <span
                    className="inbox-question-text"
                    title={`${q.text}\n（点击编辑）`}
                    onClick={() => startEdit(key, q.text)}
                  >
                    {q.text}
                  </span>
                  <label className="inbox-check" title={q.checked ? '取消入库标记' : '标记为已入库'}>
                    <input
                      type="checkbox"
                      checked={q.checked}
                      onChange={() => toggleChecked(batch.origIndex, qi)}
                    />
                  </label>
                  <button
                    className={`inbox-copy-btn${copied ? ' copied' : ''}`}
                    onClick={() => copyQuestion(q.text, key)}
                    title="复制题目"
                  >
                    {copied ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="inbox-copy-btn inbox-del-btn"
                    onClick={() => deleteQuestion(batch.origIndex, qi)}
                    title="删除题目"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
