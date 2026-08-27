'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Rating } from 'ts-fsrs';
import { parseQuestion, generateMarkdown, formatDateTime } from '@/lib/markdown';
import type { Question } from '@/lib/types';
import { previewAllRatings, rateCard, getOrCreateCard, fromCard, type PreviewResult, type RateableRating } from '@/lib/fsrsLogic';
import type { FsrsCardData, FsrsReviewEntry } from '@/lib/fsrsStore';
import WysiwygEditor from './WysiwygEditor';

const AUTO_SAVE_DELAY = 2000;

/** 评分按钮的样式后缀（对应 globals.css 的 .rq-rating-*） */
const RATING_CLASS: Record<number, string> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
};

interface Props {
  markdown: string;
  filename: string;
  category: string;
  /** 分类 slug（category 为显示名，保存时需要 slug 定位文件） */
  categorySlug?: string;
  onSave: (markdown: string, target: { category: string; filename: string }) => void;
  onBack: () => void;
  imageBase?: string;
  uploadDir?: string;
  /** random=随机练习（可评分，卡片由此诞生）；review=今日复习（评分后自动下一题） */
  mode?: 'random' | 'review';
  fsrsCard?: FsrsCardData;
  onRate?: (rating: number, cardData: FsrsCardData) => void;
  onNext?: () => void;
}

export default function RandomQuestion({ markdown, filename, category, categorySlug, onSave, onBack, imageBase = '', uploadDir = '', mode = 'random', fsrsCard, onRate, onNext }: Props) {
  const [parsed, setParsed] = useState<Question | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting'>('saved');
  // FSRS 评分行：四个评分档的间隔预告；评分后禁用整行
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [rated, setRated] = useState(false);

  const answerRef = useRef('');
  const analysisRef = useRef('');
  const answerKeyRef = useRef(0);
  const analysisKeyRef = useRef(0);
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<() => void>(() => {});
  const lastSavedMdRef = useRef('');
  const mountedRef = useRef(true);

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

    // 新题目挂载：重置评分状态并计算四档间隔预告（每个标签页对应一道题，挂载时算一次即可）
    if (onRate) {
      setPreviews(previewAllRatings(getOrCreateCard(fsrsCard)));
      setRated(false);
    }

    // Load notes from file, fall back to localStorage
    setUserNotes(q.notes || localStorage.getItem(`random-notes-${filename}`) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!parsed || !mountedRef.current) return;
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
    // 传入本组件捕获的文档定位，避免切换文档后延迟保存写入错误文件
    onSave(newMd, { category: categorySlug || category, filename });
    setSaveStatus('saved');
  }, [parsed, onSave, userNotes, categorySlug, category, filename]);
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

  // FSRS 评分：基于当前卡片算出下一状态 → 回传父组件持久化 → 复习模式 1.2s 后自动下一题
  const handleRating = (rating: RateableRating) => {
    if (rated || !onRate) return;
    const now = new Date();
    const { card: newCard, entry } = rateCard(getOrCreateCard(fsrsCard, now), rating, now);
    const history = [...((fsrsCard?.history as FsrsReviewEntry[] | undefined) || []), entry].slice(-20);
    setRated(true);
    onRate(rating, fromCard(newCard, history));
    if (onNext) {
      nextTimerRef.current = setTimeout(() => {
        if (mountedRef.current) onNext();
      }, 1200);
    }
  };

  // Auto-save is primary save mechanism (2s debounce). Ctrl+S now toggles strikethrough.

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    };
  }, []);

  if (!parsed) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>加载中...</div>;

  return (
    <div className="random-question">
      <div className="rq-header">
        <div className="rq-header-left">
          <button className="btn btn-secondary btn-small" onClick={onBack}>← 返回</button>
          <span className="rq-badge">{mode === 'review' ? '今日复习' : '随机一题'}</span>
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

      {onRate && previews.length > 0 && (
        <div className="rq-rating-row">
          <span className="rq-rating-label">{rated ? '已评分' : '回忆效果'}</span>
          {previews.map((p) => (
            <button
              key={p.rating}
              className={`rq-rating-btn rq-rating-${RATING_CLASS[p.rating]}`}
              disabled={rated}
              onClick={() => handleRating(p.rating)}
              title={`评分后下次复习间隔：${p.intervalText}`}
            >
              <span className="rq-rating-name">{p.label}</span>
              <span className="rq-rating-interval">{p.intervalText}</span>
            </button>
          ))}
        </div>
      )}

      {showAnswer && (
        <div className="doc-section">
          <div className="doc-section-header"><span className="doc-section-label">面试直接答</span></div>
          <WysiwygEditor
            key={`rq-answer-${answerKeyRef.current}`}
            initialMarkdown={answerRef.current}
            onChange={handleAnswerChange}
            placeholder="面试可直接作答的版本..."
            imageBase={imageBase}
            uploadDir={uploadDir}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
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
            imageBase={imageBase}
            uploadDir={uploadDir}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
          />
        </div>
      )}
    </div>
  );
}
