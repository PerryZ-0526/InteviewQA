'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, useId } from 'react';
import WysiwygEditor, { BacklinkEntry } from './WysiwygEditor';
import TocPanel from './TocPanel';
import BacklinksPanel, { Backlink } from './BacklinksPanel';
import { parseQuestion, generateMarkdown, formatDateTime } from '@/lib/markdown';
import {
  categoryDocumentKind,
  convertCategoryDocument,
  FREEFORM_BODY_SCHEMA,
  metadataString,
  metadataStringList,
  parseMarkdownDocument,
  serializeV2Document,
  type DocumentKind,
  type FrontmatterData,
} from '@/lib/documentFormat';
import { QUESTION_BODY_SCHEMA } from '@/lib/sectionMarkers';
import { stripMdText } from '@/lib/stripText';
import { scrollToAnchorPathPolling } from '@/lib/domScroll';
import { useCategoryRenderMode, useTocPref } from '@/lib/useTocPref';
import type { Question } from '@/lib/types';
import { useAutosave } from '@/lib/useAutosave';

const AUTO_SAVE_DELAY = 400;
const TIME_METADATA_RE = /<!--\s*(?:created|updated):[\s\S]*?-->/g;

function stripTimeMetadata(markdown: string): string {
  return markdown.replace(TIME_METADATA_RE, '').trim();
}

function extractEditableBody(markdown: string): string {
  const document = parseMarkdownDocument(markdown);
  if (
    document.sourceFormat === 'frontmatter-v2'
    && document.attributes.kind === 'document'
    && document.attributes.body_schema === FREEFORM_BODY_SCHEMA
  ) {
    return document.body;
  }
  let body = document.body.trimStart();
  if (document.sourceFormat === 'legacy' && /^#\s+/.test(body)) {
    const firstNewline = body.indexOf('\n');
    body = firstNewline >= 0 ? body.slice(firstNewline + 1) : '';
  }
  return stripTimeMetadata(body);
}

function parseContinuousQuestion(
  title: string,
  body: string,
  filename: string,
  metadataSource: Question,
  updatedAt: string,
): Question {
  return parseQuestion(
    serializeV2Document(
      {
        ...metadataSource.frontmatter,
        body_schema: QUESTION_BODY_SCHEMA,
        title,
        tags: metadataSource.tags,
        created: metadataSource.createdAt,
        updated: updatedAt,
      },
      stripTimeMetadata(body),
      'question',
    ),
    filename,
  );
}

function createCustomSectionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `custom-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
}

function customSectionKey(section: { id?: string }, index: number): string {
  return section.id || `legacy-${index}`;
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
  const [documentKind, setDocumentKind] = useState<DocumentKind>(() => categoryDocumentKind(markdown));
  const [parsed, setParsed] = useState<Question | null>(null);
  const [frontmatter, setFrontmatter] = useState<FrontmatterData>(() => parseMarkdownDocument(markdown).attributes);
  const [tags, setTags] = useState<string[]>(() => metadataStringList(parseMarkdownDocument(markdown).attributes, 'tags'));
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [answerLen, setAnswerLen] = useState(0);
  const [analysisLen, setAnalysisLen] = useState(0);
  const [notesLen, setNotesLen] = useState(0);
  // 目录显隐：按文档独立持久化，下次打开同一题仍保持上次的状态
  const documentPrefKey = `category:${category || ''}/${filename || ''}`;
  const { showToc, toggleToc } = useTocPref(documentPrefKey);
  const { renderMode, toggleRenderMode } = useCategoryRenderMode(documentPrefKey);
  const [customSections, setCustomSections] = useState<{ id?: string; title: string; content: string }[]>([]);
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [continuousBody, setContinuousBody] = useState(() => extractEditableBody(markdown));
  const [continuousEditorVersion, setContinuousEditorVersion] = useState(0);
  const [convertingKind, setConvertingKind] = useState(false);
  const customRefs = useRef<Record<string, string>>({});

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
      answer: answerRef.current,
      analysis: analysisRef.current,
      notes: hiddenSections.has('我的作答') ? '' : notesRef.current,
      customSections: customSections.map((section, index) => ({
        ...section,
        content: customRefs.current[customSectionKey(section, index)] ?? section.content,
      })),
      createdAt: createdAtRef.current,
      updatedAt,
    };
  }, [customSections, hiddenSections, parsed, question, title]);

  const serializeCurrentDocument = useCallback((updatedAt: string) => {
    updatedAtRef.current = updatedAt;
    if (documentKind === 'document') {
      return serializeV2Document(
        {
          ...frontmatter,
          body_schema: FREEFORM_BODY_SCHEMA,
          title,
          tags,
          created: createdAtRef.current,
          updated: updatedAt,
        },
        continuousBodyRef.current,
        'document',
      );
    }
    if (!parsed) return null;
    return renderMode === 'continuous'
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
        )
      : generateMarkdown(buildStructuredQuestion(updatedAt)!);
  }, [buildStructuredQuestion, documentKind, filename, frontmatter, parsed, renderMode, tags, title]);

  const buildSaveValue = useCallback(() => {
    const nextMarkdown = serializeCurrentDocument(formatDateTime(new Date()));
    if (!nextMarkdown) return null;
    ownSaveContentsRef.current.add(nextMarkdown);
    return nextMarkdown;
  }, [serializeCurrentDocument]);
  const saveDocument = useCallback(async (nextMarkdown: string) => {
    const success = await onSave(nextMarkdown, { category: category || '', filename: filename || '' });
    if (!success) ownSaveContentsRef.current.delete(nextMarkdown);
    return success;
  }, [category, filename, onSave]);
  const { status: saveStatus, schedule: scheduleSave, reset: resetSave, saveNow } = useAutosave({
    delay: AUTO_SAVE_DELAY,
    buildValue: buildSaveValue,
    save: saveDocument,
  });

  const applyQuestionState = useCallback((questionData: Question) => {
    setDocumentKind('question');
    setParsed(questionData);
    setFrontmatter(questionData.frontmatter);
    setTags(questionData.tags);
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
      nextCustomSections.map((section, index) => [customSectionKey(section, index), section.content]),
    );
    createdAtRef.current = questionData.createdAt;
    updatedAtRef.current = questionData.updatedAt;
    answerKeyRef.current += 1;
    analysisKeyRef.current += 1;
    notesKeyRef.current += 1;

    const hidden = new Set<string>();
    if (!(questionData.notes || '').trim()) hidden.add('我的作答');
    setHiddenSections(hidden);
  }, []);

  const applyMarkdownState = useCallback((content: string) => {
    const document = parseMarkdownDocument(content);
    const nextKind = categoryDocumentKind(content);
    const nextContinuousBody = extractEditableBody(content);

    setDocumentKind(nextKind);
    setFrontmatter(document.attributes);
    setTags(metadataStringList(document.attributes, 'tags'));
    continuousBodyRef.current = nextContinuousBody;
    setContinuousBody(nextContinuousBody);
    setContinuousEditorVersion((version) => version + 1);

    if (nextKind === 'question') {
      applyQuestionState(parseQuestion(content, filename || ''));
      return;
    }

    const createdAt = metadataString(document.attributes, 'created') || formatDateTime(new Date());
    setParsed(null);
    setTitle(metadataString(document.attributes, 'title'));
    setQuestion('');
    answerRef.current = '';
    analysisRef.current = '';
    notesRef.current = '';
    setAnswerLen(0);
    setAnalysisLen(0);
    setNotesLen(0);
    setCustomSections([]);
    customRefs.current = {};
    createdAtRef.current = createdAt;
    updatedAtRef.current = metadataString(document.attributes, 'updated') || createdAt;
    setHiddenSections(new Set());
  }, [applyQuestionState, filename]);

  useEffect(() => {
    const labels: Record<string, string> = { saved: '已保存', saving: '保存中...', waiting: '待保存', error: '保存失败' };
    onSaveStatusChange?.(labels[saveStatus] || '');
  }, [saveStatus, onSaveStatusChange]);

  useEffect(() => {
    // 忽略本组件保存成功后的内容回传，避免旧请求覆盖正在编辑的界面
    if (ownSaveContentsRef.current.delete(markdown)) return;

    applyMarkdownState(markdown);

    resetSave();
  }, [applyMarkdownState, markdown, resetSave]);

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
    if (!parsed || documentKind !== 'question') return;

    if (renderMode === 'sectioned') {
      const structured = buildStructuredQuestion(updatedAtRef.current || parsed.updatedAt);
      if (!structured) return;
      const nextBody = extractEditableBody(generateMarkdown(structured));
      continuousBodyRef.current = nextBody;
      setContinuousBody(nextBody);
      setContinuousEditorVersion((version) => version + 1);
    } else {
      applyQuestionState(parseContinuousQuestion(
        title,
        continuousBodyRef.current,
        filename || parsed.filename,
        {
          ...parsed,
          createdAt: createdAtRef.current || parsed.createdAt,
        },
        updatedAtRef.current || parsed.updatedAt,
      ));
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
    documentKind,
  ]);

  const handleKindConversion = useCallback(async () => {
    if (convertingKind) return;
    const targetKind: DocumentKind = documentKind === 'question' ? 'document' : 'question';
    const confirmed = window.confirm(
      targetKind === 'document'
        ? '确认转为自由文档？章节边界会被移除，现有非空内容将按原顺序合并。转换前版本会自动备份。'
        : '确认转为结构化面试题？当前正文会完整放入“详细解析”，“题目”和“面试直接答”将留空。转换前版本会自动备份。',
    );
    if (!confirmed) return;

    const updatedAt = formatDateTime(new Date());
    const currentMarkdown = serializeCurrentDocument(updatedAt);
    if (!currentMarkdown) return;

    let converted: string;
    try {
      converted = convertCategoryDocument(currentMarkdown, targetKind, updatedAt);
    } catch {
      return;
    }

    setConvertingKind(true);
    ownSaveContentsRef.current.add(converted);
    const success = await saveNow(converted);
    if (success) {
      applyMarkdownState(converted);
    } else {
      ownSaveContentsRef.current.delete(converted);
    }
    setConvertingKind(false);
  }, [
    applyMarkdownState,
    convertingKind,
    documentKind,
    saveNow,
    serializeCurrentDocument,
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
            placeholder={documentKind === 'question' ? '题目标题' : '文档标题'}
            spellCheck={false}
          />
          <div className="doc-meta">
            <span className="doc-filename">{filename}</span>
            <span className="doc-kind-badge">
              {documentKind === 'question' ? '结构化面试题' : '自由文档'}
            </span>
            {tags.length > 0 && (
              <span className="doc-tags">
                {tags.map((t) => (
                  <span key={t} className="doc-tag">{t}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="doc-header-right" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 }}>
            {documentKind === 'question' && (
              <button
                className="btn btn-small btn-secondary doc-render-mode-toggle"
                aria-pressed={renderMode === 'continuous'}
                onClick={handleRenderModeToggle}
                disabled={!parsed || convertingKind}
                title={renderMode === 'sectioned'
                  ? '当前为分段渲染，切换为整篇渲染'
                  : '当前为整篇渲染，切换为分段渲染'}
              >
                {renderMode === 'sectioned' ? '整篇编辑' : '分段编辑'}
              </button>
            )}
            <button
              className="btn btn-small btn-secondary doc-kind-convert"
              onClick={handleKindConversion}
              disabled={convertingKind}
              title={documentKind === 'question' ? '转为自由文档' : '转为结构化面试题'}
            >
              {convertingKind
                ? '转换中...'
                : documentKind === 'question'
                ? '转为自由文档'
                : '转为结构化面试题'}
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

      {documentKind === 'document' || renderMode === 'continuous' ? (
        <WysiwygEditor
          key={`continuous-${documentKind}-${category || ''}/${filename || ''}-${continuousEditorVersion}`}
          initialMarkdown={continuousBody}
          onChange={handleContinuousChange}
          placeholder="文档正文..."
          documentTitle={title}
          sectionName={title || '整篇正文'}
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

          <div className="doc-section">
            <div className="doc-section-header">
              <span className="doc-section-label" id={`${secIdPrefix}-sec-2`}>面试直接答</span>
              <span className="doc-count">{answerLen.toLocaleString()} 字</span>
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

          <div className="doc-section">
            <div className="doc-section-header">
              <span className="doc-section-label" id={`${secIdPrefix}-sec-3`}>详细解析</span>
              <span className="doc-count">{analysisLen.toLocaleString()} 字</span>
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
            <div className="doc-section" key={s.id || i} id={`${secIdPrefix}-sec-c${i}`}>
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
                key={`custom-${s.id || i}`}
                initialMarkdown={s.content}
                onChange={(md: string) => {
                  customRefs.current[customSectionKey(s, i)] = md;
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
                setCustomSections([
                  ...customSections,
                  { id: createCustomSectionId(), title: '', content: '' },
                ]);
              }}
            >+ 添加自定义章节</button>
          </div>
        </>
      )}

      <BacklinksPanel backlinks={backlinks} />
    </div>
  );
}
