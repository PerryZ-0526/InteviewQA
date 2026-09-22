'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useId } from 'react';
import WysiwygEditor, { BacklinkEntry } from './WysiwygEditor';
import TocPanel from './TocPanel';
import BacklinksPanel, { Backlink } from './BacklinksPanel';
import { parseQuestion, generateMarkdown, formatDateTime } from '@/lib/markdown';
import { stripMdText } from '@/lib/stripText';
import { scrollToAnchorPathPolling } from '@/lib/domScroll';
import { useCategoryRenderMode, useTocPref } from '@/lib/useTocPref';
import type { Question } from '@/lib/types';
import { useAutosave } from '@/lib/useAutosave';

const AUTO_SAVE_DELAY = 400;
const TIME_METADATA_RE = /<!--\s*(?:created|updated):[\s\S]*?-->/g;
const CONTINUOUS_HIDDEN_SECTIONS = new Set(['标签', '题目导航']);

function stripTimeMetadata(markdown: string): string {
  return markdown.replace(TIME_METADATA_RE, '').trim();
}

function omitContinuousHiddenSections(markdown: string): string {
  const keptLines: string[] = [];
  let inCodeBlock = false;
  let hiddenSection = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      if (!hiddenSection) keptLines.push(line);
      continue;
    }

    if (!inCodeBlock && line.startsWith('## ')) {
      const sectionName = line.slice(3).trim();
      hiddenSection = CONTINUOUS_HIDDEN_SECTIONS.has(sectionName);
    }

    if (!hiddenSection) keptLines.push(line);
  }

  return keptLines.join('\n').trim();
}

/** 整篇模式保留 H1 作为独立标题输入框，并隐藏标签、题目导航两个结构化章节 */
function extractEditableBody(markdown: string): string {
  let body = markdown.replace(/^\uFEFF/, '').trimStart();
  if (/^#\s+/.test(body)) {
    const firstNewline = body.indexOf('\n');
    body = firstNewline >= 0 ? body.slice(firstNewline + 1) : '';
  }
  return omitContinuousHiddenSections(stripTimeMetadata(body));
}

function parseContinuousQuestion(
  title: string,
  body: string,
  filename: string,
  metadataSource: Question,
  updatedAt: string,
): Question {
  const parsedBody = parseQuestion(`# ${title}\n\n${stripTimeMetadata(body)}`, filename);
  return {
    ...parsedBody,
    tags: metadataSource.tags,
    prevLink: metadataSource.prevLink,
    nextLink: metadataSource.nextLink,
    createdAt: metadataSource.createdAt,
    updatedAt,
  };
}

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
  const [answerLen, setAnswerLen] = useState(0);
  const [analysisLen, setAnalysisLen] = useState(0);
  const [notesLen, setNotesLen] = useState(0);
  // 目录显隐：按文档独立持久化，下次打开同一题仍保持上次的状态
  const documentPrefKey = `category:${category || ''}/${filename || ''}`;
  const { showToc, toggleToc } = useTocPref(documentPrefKey);
  const { renderMode, toggleRenderMode } = useCategoryRenderMode(documentPrefKey);
  const [customSections, setCustomSections] = useState<{ title: string; content: string }[]>([]);
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [continuousBody, setContinuousBody] = useState(() => extractEditableBody(markdown));
  const [continuousEditorVersion, setContinuousEditorVersion] = useState(0);
  const customRefs = useRef<Record<number, string>>({});

  const answerRef = useRef('');
  const analysisRef = useRef('');
  const notesRef = useRef('');
  const continuousBodyRef = useRef(extractEditableBody(markdown));
  const answerKeyRef = useRef(0);
  const analysisKeyRef = useRef(0);
  const notesKeyRef = useRef(0);
  const createdAtRef = useRef('');
  const updatedAtRef = useRef('');
  const ownSaveContentsRef = useRef<Set<string>>(new Set());

  const buildStructuredQuestion = useCallback((updatedAt: string): Question | null => {
    if (!parsed) return null;
    return {
      ...parsed,
      title,
      question,
      answer: hiddenSections.has('面试直接答') ? '' : answerRef.current,
      analysis: hiddenSections.has('详细解析') ? '' : analysisRef.current,
      notes: hiddenSections.has('我的作答') ? '' : notesRef.current,
      customSections: customSections.map((section, index) => ({
        title: section.title,
        content: customRefs.current[index] ?? section.content,
      })),
      createdAt: createdAtRef.current,
      updatedAt,
    };
  }, [customSections, hiddenSections, parsed, question, title]);

  const buildSaveValue = useCallback(() => {
    if (!parsed) return null;
    const updatedAt = formatDateTime(new Date());
    updatedAtRef.current = updatedAt;
    const nextMarkdown = renderMode === 'continuous'
      ? generateMarkdown(
          parseContinuousQuestion(
            title,
            continuousBodyRef.current,
            filename || parsed.filename,
            {
              ...parsed,
              createdAt: createdAtRef.current || parsed.createdAt,
            },
            updatedAt,
          ),
          { omitEmptyQuestion: true },
        )
      : generateMarkdown(buildStructuredQuestion(updatedAt)!);
    ownSaveContentsRef.current.add(nextMarkdown);
    return nextMarkdown;
  }, [buildStructuredQuestion, filename, parsed, renderMode, title]);
  const saveDocument = useCallback(async (nextMarkdown: string) => {
    const success = await onSave(nextMarkdown, { category: category || '', filename: filename || '' });
    if (!success) ownSaveContentsRef.current.delete(nextMarkdown);
    return success;
  }, [category, filename, onSave]);
  const { status: saveStatus, schedule: scheduleSave, reset: resetSave } = useAutosave({
    delay: AUTO_SAVE_DELAY,
    buildValue: buildSaveValue,
    save: saveDocument,
  });

  const applyQuestionState = useCallback((questionData: Question) => {
    setParsed(questionData);
    setTitle(questionData.title);
    setQuestion(questionData.question);
    answerRef.current = questionData.answer;
    analysisRef.current = questionData.analysis;
    notesRef.current = questionData.notes || '';
    setAnswerLen(questionData.answer.length);
    setAnalysisLen(questionData.analysis.length);
    setNotesLen((questionData.notes || '').length);
    const nextCustomSections = questionData.customSections || [];
    setCustomSections(nextCustomSections);
    customRefs.current = Object.fromEntries(
      nextCustomSections.map((section, index) => [index, section.content]),
    );
    createdAtRef.current = questionData.createdAt;
    updatedAtRef.current = questionData.updatedAt;
    answerKeyRef.current += 1;
    analysisKeyRef.current += 1;
    notesKeyRef.current += 1;

    const hidden = new Set<string>();
    if (!questionData.answer.trim()) hidden.add('面试直接答');
    if (!questionData.analysis.trim()) hidden.add('详细解析');
    if (!(questionData.notes || '').trim()) hidden.add('我的作答');
    setHiddenSections(hidden);
  }, []);

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存', error: '保存失败' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);

  useEffect(() => {
    // 忽略本组件保存成功后的内容回传，避免旧请求覆盖正在编辑的界面
    if (ownSaveContentsRef.current.delete(markdown)) return;

    const q = parseQuestion(markdown, filename || '');
    applyQuestionState(q);
    const nextContinuousBody = extractEditableBody(markdown);
    continuousBodyRef.current = nextContinuousBody;
    setContinuousBody(nextContinuousBody);
    setContinuousEditorVersion((version) => version + 1);

    resetSave();
  }, [applyQuestionState, markdown, filename, resetSave]);

  const handleAnswerChange = useCallback((md: string) => {
    answerRef.current = md;
    setAnswerLen(md.length);
    scheduleSave();
  }, [scheduleSave]);

  const handleAnalysisChange = useCallback((md: string) => {
    analysisRef.current = md;
    setAnalysisLen(md.length);
    scheduleSave();
  }, [scheduleSave]);

  const handleTitleChange = useCallback((val: string) => {
    setTitle(val);
    scheduleSave();
  }, [scheduleSave]);

  const handleNotesChange = useCallback((md: string) => {
    notesRef.current = md;
    setNotesLen(md.length);
    scheduleSave();
  }, [scheduleSave]);

  const handleQuestionChange = useCallback((val: string) => {
    setQuestion(val);
    scheduleSave();
  }, [scheduleSave]);

  const handleContinuousChange = useCallback((body: string) => {
    continuousBodyRef.current = body;
    scheduleSave();
  }, [scheduleSave]);

  const handleRenderModeToggle = useCallback(() => {
    if (!parsed) return;

    if (renderMode === 'sectioned') {
      const structured = buildStructuredQuestion(updatedAtRef.current || parsed.updatedAt);
      if (!structured) return;
      const nextBody = extractEditableBody(generateMarkdown(structured, { omitEmptyQuestion: true }));
      continuousBodyRef.current = nextBody;
      setContinuousBody(nextBody);
      setContinuousEditorVersion((version) => version + 1);
    } else {
      const continuousQuestion = parseContinuousQuestion(
        title,
        continuousBodyRef.current,
        filename || parsed.filename,
        {
          ...parsed,
          createdAt: createdAtRef.current || parsed.createdAt,
        },
        updatedAtRef.current || parsed.updatedAt,
      );
      applyQuestionState(continuousQuestion);
    }

    toggleRenderMode();
  }, [
    applyQuestionState,
    buildStructuredQuestion,
    filename,
    parsed,
    renderMode,
    title,
    toggleRenderMode,
  ]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn btn-small btn-secondary doc-render-mode-toggle"
              aria-pressed={renderMode === 'continuous'}
              onClick={handleRenderModeToggle}
              disabled={!parsed}
              title={renderMode === 'sectioned'
                ? '当前为分段渲染，切换为整篇渲染'
                : '当前为整篇渲染，切换为分段渲染'}
            >
              {renderMode === 'sectioned' ? '整篇编辑' : '分段编辑'}
            </button>
            <button
              className="btn btn-small btn-secondary doc-toc-toggle"
              data-expanded={showToc}
              aria-expanded={showToc}
              onClick={toggleToc}
              title={showToc ? '隐藏目录' : '展开目录'}
            >
              {showToc ? '隐藏目录' : '目录'}
            </button>
          </div>
          <div className="doc-time-info">
            {createdAtRef.current && <span>创建：{createdAtRef.current}</span>}
            {updatedAtRef.current && <span>修改：{updatedAtRef.current}</span>}
          </div>
        </div>
      </div>

      {showToc && <TocPanel />}

      {renderMode === 'continuous' ? (
        <WysiwygEditor
          key={`continuous-${category || ''}/${filename || ''}-${continuousEditorVersion}`}
          initialMarkdown={continuousBody}
          onChange={handleContinuousChange}
          placeholder="文档正文..."
          documentTitle={parsed?.title || ''}
          sectionName={parsed?.title || '整篇正文'}
          imageBase={imageBase}
          uploadDir={uploadDir}
          backlinkMap={backlinkMap}
          docKey={filename ? filename.replace(/\.md$/, '') : ''}
        />
      ) : (
        <>
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
                <button
                  className="btn btn-small btn-danger"
                  style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }}
                  onClick={() => {
                    answerRef.current = '';
                    setAnswerLen(0);
                    setHiddenSections(prev => new Set([...prev, '面试直接答']));
                    scheduleSave();
                  }}
                  title="删除此章节"
                >×</button>
              </div>
              <WysiwygEditor
                key={`answer-${answerKeyRef.current}`}
                initialMarkdown={answerRef.current}
                onChange={handleAnswerChange}
                placeholder="面试可直接作答的版本..."
                documentTitle={parsed?.title || ''}
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
                <button
                  className="btn btn-small btn-danger"
                  style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }}
                  onClick={() => {
                    analysisRef.current = '';
                    setAnalysisLen(0);
                    setHiddenSections(prev => new Set([...prev, '详细解析']));
                    scheduleSave();
                  }}
                  title="删除此章节"
                >×</button>
              </div>
              <WysiwygEditor
                key={`analysis-${analysisKeyRef.current}`}
                initialMarkdown={analysisRef.current}
                onChange={handleAnalysisChange}
                placeholder="详细解析内容..."
                documentTitle={parsed?.title || ''}
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
                <button
                  className="btn btn-small btn-danger"
                  style={{ marginLeft: 8, padding: '0 6px', fontSize: 14 }}
                  onClick={() => {
                    notesRef.current = '';
                    setNotesLen(0);
                    setHiddenSections(prev => new Set([...prev, '我的作答']));
                    scheduleSave();
                  }}
                  title="删除此章节"
                >×</button>
              </div>
              <WysiwygEditor
                key={`notes-${notesKeyRef.current}`}
                initialMarkdown={notesRef.current}
                onChange={handleNotesChange}
                placeholder="记录你的作答思路、要点..."
                documentTitle={parsed?.title || ''}
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
                    scheduleSave();
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
                    scheduleSave();
                  }}
                  placeholder="自定义章节标题..."
                  spellCheck={false}
                />
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => {
                    const updated = customSections.filter((_, j) => j !== i);
                    setCustomSections(updated);
                    scheduleSave();
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
                  scheduleSave();
                }}
                placeholder="自定义内容..."
                documentTitle={parsed?.title || ''}
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
        </>
      )}

      <BacklinksPanel backlinks={backlinks} />
    </div>
  );
}
