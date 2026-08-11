'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseQuestion, generateMarkdown, formatDateTime } from '@/lib/markdown';
import type { Question } from '@/lib/types';
import WysiwygEditor from './WysiwygEditor';

const AUTO_SAVE_DELAY = 2000;

interface Props {
  markdown: string;
  filename: string;
  category: string;
  onSave: (markdown: string) => void;
  onBack: () => void;
}

export default function RandomQuestion({ markdown, filename, category, onSave, onBack }: Props) {
  const [parsed, setParsed] = useState<Question | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting'>('saved');

  const answerRef = useRef('');
  const analysisRef = useRef('');
  const answerKeyRef = useRef(0);
  const analysisKeyRef = useRef(0);
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<() => void>(() => {});
  const lastSavedMdRef = useRef('');

  useEffect(() => {
    if (markdown === lastSavedMdRef.current) return;

    const q = parseQuestion(markdown, filename);
    setParsed(q);
    answerRef.current = q.answer;
    analysisRef.current = q.analysis;
    createdAtRef.current = q.createdAt;
    updatedAtRef.current = q.updatedAt;
    answerKeyRef.current += 1;
    analysisKeyRef.current += 1;
    setSaveStatus('saved');
    setShowAnswer(false);
    setShowAnalysis(false);

    // Load notes from file, fall back to localStorage
    setUserNotes(q.notes || localStorage.getItem(`random-notes-${filename}`) || '');
  }, [markdown, filename]);

  // Debounced auto-save (for WYSIWYG content changes)
  const triggerAutoSave = useCallback(() => {
    setSaveStatus('waiting');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSaveRef.current();
    }, AUTO_SAVE_DELAY);
  }, []);

  const doSave = useCallback(() => {
    if (!parsed) return;
    setSaveStatus('saving');
    const updated: Question = {
      ...parsed,
      answer: answerRef.current,
      analysis: analysisRef.current,
      notes: userNotes,
      createdAt: createdAtRef.current,
      updatedAt: formatDateTime(new Date()),
    };
    updatedAtRef.current = updated.updatedAt;
    const newMd = generateMarkdown(updated);
    lastSavedMdRef.current = newMd;
    onSave(newMd);
    setSaveStatus('saved');
  }, [parsed, onSave, userNotes]);
  doSaveRef.current = doSave;

  const handleAnswerChange = useCallback((md: string) => {
    answerRef.current = md;
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleAnalysisChange = useCallback((md: string) => {
    analysisRef.current = md;
    triggerAutoSave();
  }, [triggerAutoSave]);

  // Notes save to localStorage (instant) + md file (debounced)
  const handleNotesChange = useCallback((text: string) => {
    setUserNotes(text);
    localStorage.setItem(`random-notes-${filename}`, text);
    triggerAutoSave();
  }, [filename, triggerAutoSave]);

  // Auto-save is primary save mechanism (2s debounce). Ctrl+S now toggles strikethrough.

  useEffect(() => {
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, []);

  if (!parsed) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>加载中...</div>;

  return (
    <div className="random-question">
      <div className="rq-header">
        <div className="rq-header-left">
          <button className="btn btn-secondary btn-small" onClick={onBack}>← 返回</button>
          <span className="rq-badge">随机一题</span>
          <span className="rq-category">{category}</span>
          <span className="rq-filename">{filename}</span>
        </div>
        <div className="rq-header-right">
          <div className="doc-save-status" data-status={saveStatus}>
            {saveStatus === 'saving' && '保存中...'}
            {saveStatus === 'waiting' && '待保存'}
            {saveStatus === 'saved' && '已保存'}
          </div>
          <div className="doc-time-info">
            {createdAtRef.current && <span>创建：{createdAtRef.current}</span>}
            {updatedAtRef.current && <span>修改：{updatedAtRef.current}</span>}
          </div>
        </div>
      </div>

      <div className="rq-question-card">
        <h1 className="rq-title">{parsed.title}</h1>
        <div className="rq-meta">
          {parsed.tags.map((t) => <span key={t} className="doc-tag">{t}</span>)}
        </div>
        <div className="rq-question-text">{parsed.question}</div>
      </div>

      <div className="rq-notes-section">
        <div className="doc-section-header">
          <span className="doc-section-label">我的作答</span>
        </div>
        <textarea
          className="rq-notes-input"
          value={userNotes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder="在这里写下你的作答思路、关键点、口语化表述..."
          rows={6}
        />
        <div className="rq-notes-hint">
          作答内容自动保存到题目文件末尾（不可见注释区）。停止输入 2 秒后即保存。
        </div>
      </div>

      <div className="rq-toggles">
        <button className={`rq-toggle-btn ${showAnswer ? 'active' : ''}`} onClick={() => setShowAnswer(!showAnswer)}>
          {showAnswer ? '隐藏' : '展开'} 面试直接答
        </button>
        <button className={`rq-toggle-btn ${showAnalysis ? 'active' : ''}`} onClick={() => setShowAnalysis(!showAnalysis)}>
          {showAnalysis ? '隐藏' : '展开'} 详细解析
        </button>
      </div>

      {showAnswer && (
        <div className="doc-section">
          <div className="doc-section-header"><span className="doc-section-label">面试直接答</span></div>
          <WysiwygEditor
            key={`rq-answer-${answerKeyRef.current}`}
            initialMarkdown={answerRef.current}
            onChange={handleAnswerChange}
            placeholder="面试可直接作答的版本..."
          />
        </div>
      )}

      {showAnalysis && (
        <div className="doc-section">
          <div className="doc-section-header"><span className="doc-section-label">详细解析</span></div>
          <WysiwygEditor
            key={`rq-analysis-${analysisKeyRef.current}`}
            initialMarkdown={analysisRef.current}
            onChange={handleAnalysisChange}
            placeholder="详细解析内容..."
          />
        </div>
      )}
    </div>
  );
}
