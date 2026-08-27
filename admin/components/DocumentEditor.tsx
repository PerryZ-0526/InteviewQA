'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useId } from 'react';
import WysiwygEditor, { BacklinkEntry } from './WysiwygEditor';
import TocPanel from './TocPanel';
import BacklinksPanel, { Backlink } from './BacklinksPanel';
import { parseQuestion, generateMarkdown, formatDateTime } from '@/lib/markdown';
import { stripMdText } from '@/lib/stripText';
import { scrollToAnchorPathPolling } from '@/lib/domScroll';
import type { Question } from '@/lib/types';

const AUTO_SAVE_DELAY = 400;

interface Props {
  markdown: string;
  filename?: string;
  category?: string;
  onSave: (markdown: string, target: { category: string; filename: string }) => Promise<boolean>;
  onSaveStatusChange?: (status: string) => void;
  pendingAnchor?: string[] | null;
  onAnchorDone?: () => void;
}

export default function DocumentEditor({ markdown, filename, category, onSave, onSaveStatusChange, pendingAnchor, onAnchorDone }: Props) {
  const imageBase = category ? `/api/raw/categories/${encodeURIComponent(category)}` : '';
  const uploadDir = category ? `categories/${category}` : '';
  // 章节 id 加每实例唯一前缀：多标签页并存时避免重复 id 导致 getElementById 命中第一个标签的隐藏章节
  const secIdPrefix = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const [parsed, setParsed] = useState<Question | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'waiting' | 'error'>('saved');

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存', error: '保存失败' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);
  const [answerLen, setAnswerLen] = useState(0);
  const [analysisLen, setAnalysisLen] = useState(0);
  const [notesLen, setNotesLen] = useState(0);
  const [showToc, setShowToc] = useState(true);
  const [customSections, setCustomSections] = useState<{ title: string; content: string }[]>([]);
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const customRefs = useRef<Record<number, string>>({});

  const answerRef = useRef('');
  const analysisRef = useRef('');
  const notesRef = useRef('');
  const answerKeyRef = useRef(0);
  const analysisKeyRef = useRef(0);
  const notesKeyRef = useRef(0);
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSaveRef = useRef<() => void>(() => {});
  const ownSaveContentsRef = useRef<Set<string>>(new Set());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // 忽略本组件保存成功后的内容回传，避免旧请求覆盖正在编辑的界面
    if (ownSaveContentsRef.current.delete(markdown)) return;

    const q = parseQuestion(markdown, filename || '');
    setParsed(q);
    setTitle(q.title);
    setQuestion(q.question);
    answerRef.current = q.answer;
    analysisRef.current = q.analysis;
    notesRef.current = q.notes || '';
    setAnswerLen(q.answer.length);
    setAnalysisLen(q.analysis.length);
    setNotesLen((q.notes || '').length);
    setCustomSections(q.customSections || []);
    createdAtRef.current = q.createdAt;
    updatedAtRef.current = q.updatedAt;
    answerKeyRef.current += 1;
    analysisKeyRef.current += 1;
    notesKeyRef.current += 1;

    // 空内容的标准章节默认隐藏
    const hidden = new Set<string>();
    if (!q.answer.trim()) hidden.add('面试直接答');
    if (!q.analysis.trim()) hidden.add('详细解析');
    if (!(q.notes || '').trim()) hidden.add('我的作答');
    setHiddenSections(hidden);

    setSaveStatus('saved');
  }, [markdown, filename]);

  // Debounced auto-save (doSaveRef kept in sync below)
  const triggerAutoSave = useCallback(() => {
    editVersionRef.current += 1;
    setSaveStatus('waiting');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doSaveRef.current();
    }, AUTO_SAVE_DELAY);
  }, []);

  const doSave = useCallback(() => {
    if (!parsed) return;
    const editVersion = editVersionRef.current;
    setSaveStatus('saving');
    const updated: Question = {
      ...parsed,
      title,
      question,
      answer: hiddenSections.has('面试直接答') ? '' : answerRef.current,
      analysis: hiddenSections.has('详细解析') ? '' : analysisRef.current,
      notes: hiddenSections.has('我的作答') ? '' : notesRef.current,
      customSections: customSections.map((s, i) => ({ title: s.title, content: customRefs.current[i] || s.content })),
      createdAt: createdAtRef.current,
      updatedAt: formatDateTime(new Date()),
    };
    updatedAtRef.current = updated.updatedAt;
    const newMd = generateMarkdown(updated);
    ownSaveContentsRef.current.add(newMd);

    // 保存请求按触发顺序执行，避免较慢的旧请求覆盖较新的内容；
    // 组件卸载后不再落盘，防止切换文档后延迟保存写入错误文件
    const target = { category: category || '', filename: filename || '' };
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (!mountedRef.current) return;
      const success = await onSave(newMd, target);
      if (!success) ownSaveContentsRef.current.delete(newMd);
      if (editVersion === editVersionRef.current) {
        setSaveStatus(success ? 'saved' : 'error');
      }
    });
  }, [parsed, title, question, onSave, customSections, category, filename]);
  doSaveRef.current = doSave;

  const handleAnswerChange = useCallback((md: string) => {
    answerRef.current = md;
    setAnswerLen(md.length);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleAnalysisChange = useCallback((md: string) => {
    analysisRef.current = md;
    setAnalysisLen(md.length);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleTitleChange = useCallback((val: string) => {
    setTitle(val);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleNotesChange = useCallback((md: string) => {
    notesRef.current = md;
    setNotesLen(md.length);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleQuestionChange = useCallback((val: string) => {
    setQuestion(val);
    triggerAutoSave();
  }, [triggerAutoSave]);

  // Auto-save is primary save mechanism (2s debounce). Ctrl+S now toggles strikethrough.

  // Cleanup timer on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // 拉取反向引用
  useEffect(() => {
    if (!category || !filename) return;
    (async () => {
      try {
        const res = await fetch(`/api/backlinks?kind=category&category=${encodeURIComponent(category)}&filename=${encodeURIComponent(filename)}`);
        const json = await res.json();
        if (json.success) setBacklinks(json.data || []);
      } catch {}
    })();
  }, [category, filename]);

  // 构建 标题文本 → 反向索引条目 映射（供编辑器挂件使用）
  const backlinkMap = useMemo(() => {
    const map: Record<string, BacklinkEntry[]> = {};
    for (const bl of backlinks) {
      const path = bl.resolved?.resolvedPath || [];
      if (path.length === 0) continue;
      const key = stripMdText(path[path.length - 1]);
      if (!key) continue;
      (map[key] ||= []).push({
        sourceDocKey: bl.sourceFilename.replace(/\.md$/, ''),
        sourceTitle: bl.sourceTitle,
        contextAnchor: bl.contextAnchor || [],
      });
    }
    return map;
  }, [backlinks]);

  // wiki 链接跳转：用 useLayoutEffect 在浏览器绘制前发起定位，配合 rAF 轮询，
  // 尽量在第一帧就把视图放到目标标题，避免"先显示顶部再跳"的闪烁
  useLayoutEffect(() => {
    if (!pendingAnchor || !markdown) return;
    const cancel = scrollToAnchorPathPolling(pendingAnchor, () => onAnchorDone?.());
    return cancel;
  }, [pendingAnchor, markdown]);



  return (
    <div className="document-editor">
      <div className="doc-header">
        <div className="doc-header-left">
          <input
            className="doc-title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="题目标题"
            spellCheck={false}
          />
          <div className="doc-meta">
            <span className="doc-filename">{filename}</span>
            {(parsed?.tags || []).length > 0 && (
              <span className="doc-tags">
                {(parsed?.tags || []).map((t) => (
                  <span key={t} className="doc-tag">{t}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="doc-header-right" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button
            className="btn btn-small btn-secondary doc-toc-toggle"
            data-expanded={showToc}
            aria-expanded={showToc}
            onClick={() => setShowToc(!showToc)}
            title={showToc ? '隐藏目录' : '展开目录'}
          >
            {showToc ? '隐藏目录' : '目录'}
          </button>
          <div className="doc-time-info">
            {createdAtRef.current && <span>创建：{createdAtRef.current}</span>}
            {updatedAtRef.current && <span>修改：{updatedAtRef.current}</span>}
          </div>
        </div>
      </div>

      {showToc && (
        <TocPanel sections={[
          { id: `${secIdPrefix}-sec-1`, label: '题目' },
          ...(hiddenSections.has('面试直接答') ? [] : [{ id: `${secIdPrefix}-sec-2`, label: '面试直接答', markdown: answerRef.current }]),
          ...(hiddenSections.has('详细解析') ? [] : [{ id: `${secIdPrefix}-sec-3`, label: '详细解析', markdown: analysisRef.current }]),
          ...(hiddenSections.has('我的作答') ? [] : [{ id: `${secIdPrefix}-sec-4`, label: '我的作答', markdown: notesRef.current }]),
          ...customSections.map((s: any, i: number) => ({ id: `${secIdPrefix}-sec-c${i}`, label: s.title || '未命名', markdown: customRefs.current[i] || s.content })),
        ]} />
      )}

      <div className="doc-section" id={`${secIdPrefix}-sec-1`}>
        <div className="doc-section-header">
          <span className="doc-section-label">题目</span>
        </div>
        <textarea
          className="doc-input"
          value={question}
          onChange={(e) => handleQuestionChange(e.target.value)}
          rows={2}
          placeholder="面试题目..."
          spellCheck={false}
        />
      </div>

      {!hiddenSections.has('面试直接答') && (
        <div className="doc-section">
          <div className="doc-section-header">
            <span className="doc-section-label" id={`${secIdPrefix}-sec-2`}>面试直接答</span>
            <span className="doc-count">{answerLen.toLocaleString()} 字</span>
            <button className="btn btn-small btn-danger" style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }} onClick={() => {
              answerRef.current = '';
              setAnswerLen(0);
              setHiddenSections(prev => new Set([...prev, '面试直接答']));
              triggerAutoSave();
            }} title="删除此章节">×</button>
          </div>
          <WysiwygEditor
            key={`answer-${answerKeyRef.current}`}
            initialMarkdown={answerRef.current}
            onChange={handleAnswerChange}
            placeholder="面试可直接作答的版本..."
            documentTitle={parsed?.title || ""}
            sectionName="面试直接答"
            imageBase={imageBase}
            uploadDir={uploadDir}
            backlinkMap={backlinkMap}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
          />
        </div>
      )}

      {!hiddenSections.has('详细解析') && (
        <div className="doc-section">
          <div className="doc-section-header">
            <span className="doc-section-label" id={`${secIdPrefix}-sec-3`}>详细解析</span>
            <span className="doc-count">{analysisLen.toLocaleString()} 字</span>
            <button className="btn btn-small btn-danger" style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }} onClick={() => {
              analysisRef.current = '';
              setAnalysisLen(0);
              setHiddenSections(prev => new Set([...prev, '详细解析']));
              triggerAutoSave();
            }} title="删除此章节">×</button>
          </div>
          <WysiwygEditor
            key={`analysis-${analysisKeyRef.current}`}
            initialMarkdown={analysisRef.current}
            onChange={handleAnalysisChange}
            placeholder="详细解析内容..."
            documentTitle={parsed?.title || ""}
            sectionName="详细解析"
            imageBase={imageBase}
            uploadDir={uploadDir}
            backlinkMap={backlinkMap}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
          />
        </div>
      )}

      {!hiddenSections.has('我的作答') && (
        <div className="doc-section">
          <div className="doc-section-header">
            <span className="doc-section-label" id={`${secIdPrefix}-sec-4`}>我的作答</span>
            <span className="doc-count">{notesLen.toLocaleString()} 字</span>
            <button className="btn btn-small btn-danger" style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }} onClick={() => {
              notesRef.current = '';
              setNotesLen(0);
              setHiddenSections(prev => new Set([...prev, '我的作答']));
              triggerAutoSave();
            }} title="删除此章节">×</button>
          </div>
          <WysiwygEditor
            key={`notes-${notesKeyRef.current}`}
            initialMarkdown={notesRef.current}
            onChange={handleNotesChange}
            placeholder="记录你的作答思路、要点..."
            documentTitle={parsed?.title || ""}
            sectionName="我的作答"
            imageBase={imageBase}
            uploadDir={uploadDir}
            backlinkMap={backlinkMap}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
          />
        </div>
      )}

      {/* Restore deleted sections */}
      {hiddenSections.size > 0 && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          {Array.from(hiddenSections).map(s => (
            <button
              key={s}
              className="btn btn-small btn-secondary"
              style={{ margin: 2 }}
              onClick={() => {
                setHiddenSections(prev => {
                  const next = new Set(prev);
                  next.delete(s);
                  return next;
                });
                triggerAutoSave();
              }}
            >恢复「{s}」</button>
          ))}
        </div>
      )}

      {/* Custom sections */}
      {customSections.map((s, i) => (
        <div className="doc-section" key={i} id={`${secIdPrefix}-sec-c${i}`}>
          <div className="doc-section-header">
            <input
              className="doc-custom-title"
              value={s.title}
              onChange={e => {
                const updated = [...customSections];
                updated[i] = { ...updated[i], title: e.target.value };
                setCustomSections(updated);
                triggerAutoSave();
              }}
              placeholder="自定义章节标题..."
              spellCheck={false}
            />
            <button
              className="btn btn-small btn-danger"
              onClick={() => {
                const updated = customSections.filter((_, j) => j !== i);
                setCustomSections(updated);
                triggerAutoSave();
              }}
              style={{ marginLeft: 8 }}
              title="删除此章节"
            >×</button>
          </div>
          <WysiwygEditor
            key={`custom-${i}`}
            initialMarkdown={s.content}
            onChange={(md: string) => {
              customRefs.current[i] = md;
              triggerAutoSave();
            }}
            placeholder="自定义内容..."
            documentTitle={parsed?.title || ""}
            sectionName={s.title}
            imageBase={imageBase}
            uploadDir={uploadDir}
            backlinkMap={backlinkMap}
            docKey={filename ? filename.replace(/\.md$/, '') : ''}
          />
        </div>
      ))}

      {/* Add custom section button */}
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button
          className="btn btn-secondary btn-small"
          onClick={() => {
            setCustomSections([...customSections, { title: '', content: '' }]);
          }}
        >+ 添加自定义章节</button>
      </div>

      <BacklinksPanel backlinks={backlinks} />
    </div>
  );
}
