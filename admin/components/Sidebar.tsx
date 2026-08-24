'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CategoryInfo, TagInfo, ProjectSubdir, ExternalDocInfo } from '@/lib/types';
import { useSidebarDrag } from './useSidebarDrag';

interface Props {
  categories: CategoryInfo[];
  tags: TagInfo[];
  selectedCategory: string | null;
  selectedFile: string | null;
  onSelectCategory: (slug: string) => void;
  onSelectQuestion: (category: string, filename: string) => void;
  onSelectTag?: (tagName: string) => void;
  onSelectProgram?: (subdir: string, filename: string) => void;
  onSelectProjectSubdir?: (subdir: string) => void;
  onSelectExternalDoc?: (id: string) => void;
  onSelectExternalList?: () => void;
  onExternalMissing?: (path: string) => void;
  onNewQuestion: () => void;
  onRefresh: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onGoHome?: () => void;
  refreshKey?: number;
  onMoveQuestion: (fromCat: string, filename: string, toCat: string, toIndex: number) => void;
}

interface CreateForm {
  type: 'category' | 'project-subdir' | 'group' | 'category-doc' | 'project-doc';
  parent?: string; // category slug or project subdir slug
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '-').trim();
}

export default function Sidebar({
  categories,
  tags,
  selectedCategory,
  selectedFile,
  onSelectCategory,
  onSelectQuestion,
  onSelectTag,
  onSelectProgram,
  onSelectProjectSubdir,
  onSelectExternalDoc,
  onSelectExternalList,
  onExternalMissing,
  onNewQuestion,
  onRefresh,
  onToast,
  onGoHome,
  refreshKey = 0,
  onMoveQuestion,
}: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedProjectSubdirs, setExpandedProjectSubdirs] = useState<Set<string>>(new Set());
  const [projectSubdirs, setProjectSubdirs] = useState<ProjectSubdir[]>([]);
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([]);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [addExternalOpen, setAddExternalOpen] = useState(false);
  const [externalPathsText, setExternalPathsText] = useState('');
  const [addingExternal, setAddingExternal] = useState(false);
  const [picking, setPicking] = useState<'file' | 'folder' | null>(null);
  const [externalError, setExternalError] = useState('');
  const [renameTarget, setRenameTarget] = useState<ExternalDocInfo | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/project');
        const json = await res.json();
        if (json.success) setProjectSubdirs(json.data || []);
      } catch {}
    })();
    (async () => {
      try {
        const res = await fetch('/api/external');
        const json = await res.json();
        if (json.success) setExternalDocs(json.data || []);
      } catch {}
    })();
  }, [refreshKey]);

  // 当前题目发生变化时，自动展开它所属的分类
  useEffect(() => {
    if (!selectedCategory || !selectedFile) return;
    setExpandedCategories((prev) => {
      if (prev.has(selectedCategory)) return prev;
      const next = new Set(prev);
      next.add(selectedCategory);
      return next;
    });
  }, [selectedCategory, selectedFile]);

  const toggleCategory = (slug: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  // ---- 拖拽移动（分类题目 → 分类区块） ----
  const drag = useSidebarDrag({
    onMoveQuestion,
    onExpandCategory: (slug) => {
      setExpandedCategories((prev) => {
        if (prev.has(slug)) return prev;
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
    },
  });

  // FLIP 动画：拖放后（乐观更新生效）把受影响行从旧位置平滑过渡到新位置。
  // 全部走内联样式，避免 React 重渲染覆盖过渡状态。
  useLayoutEffect(() => {
    const pending = drag.flipBeforeRef.current;
    if (!pending || pending.before.size === 0) return;
    drag.flipBeforeRef.current = null;

    const rows = document.querySelectorAll<HTMLElement>('[data-sidebar-draggable]');
    const shifted: HTMLElement[] = [];
    for (const el of Array.from(rows)) {
      const key = `${el.dataset.catSlug}:${el.dataset.filename}`;
      const before = pending.before.get(key);
      if (!before) continue;
      const dy = el.getBoundingClientRect().top - before.top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${-dy}px)`;
      shifted.push(el);
    }
    // 被插入行：若未被 FLIP 覆盖（如源分类被折叠导致捕获不到旧位置），做淡入 + 上浮补偿
    const inserted = pending.insertKey
      ? Array.from(rows).find((el) => `${el.dataset.catSlug}:${el.dataset.filename}` === pending.insertKey)
      : undefined;
    if (inserted && !shifted.includes(inserted)) {
      inserted.style.transition = 'none';
      inserted.style.opacity = '0';
      inserted.style.transform = 'translateY(-8px)';
      shifted.push(inserted);
    }

    void document.body.offsetHeight; // 强制回流，让浏览器记录起始状态

    for (const el of shifted) {
      el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      el.style.transform = '';
      el.style.opacity = '';
    }
    const t = window.setTimeout(() => {
      for (const el of shifted) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }
    }, 250);
    return () => clearTimeout(t);
  }, [categories, drag.flipBeforeRef]);

  const openForm = (type: CreateForm['type'], parent?: string) => {
    setCreateForm({ type, parent });
    setFormName('');
    setFormSlug('');
  };

  const closeForm = () => {
    setCreateForm(null);
    setFormName('');
    setFormSlug('');
    setFormError('');
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !createForm) return;
    setCreating(true);
    setFormError('');

    try {
      let res: Response | null = null;
      if (createForm.type === 'category') {
        const slug = formSlug.trim() || slugify(formName);
        res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, displayName: formName.trim() }),
        });
      } else if (createForm.type === 'project-subdir') {
        const slug = formSlug.trim() || slugify(formName);
        res = await fetch('/api/project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, displayName: formName.trim() }),
        });
      } else if (createForm.type === 'group') {
        const slug = formSlug.trim() || slugify(formName);
        res = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, displayName: formName.trim() }),
        });
      } else if (createForm.type === 'category-doc') {
        res = await fetch(`/api/categories/${createForm.parent}/empty`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: formName.trim() }),
        });
      } else if (createForm.type === 'project-doc') {
        res = await fetch(`/api/project/${createForm.parent}/empty`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: formName.trim() }),
        });
      }

      if (res && res.ok) {
        onRefresh();
        closeForm();
      } else if (res) {
        const json = await res.json().catch(() => ({ error: '创建失败' }));
        setFormError(json.error || '创建失败');
      }
    } catch {
      setFormError('网络错误，请重试');
    }
    setCreating(false);
  };

  const addPaths = async (paths: string[]) => {
    setAddingExternal(true);
    setExternalError('');
    try {
      const res = await fetch('/api/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      const json = await res.json().catch(() => ({ error: '添加失败' }));
      if (json.success) {
        const failed = json.failed || [];
        let msg = `已索引 ${json.added.length} 篇外部文档`;
        if (json.skipped.length > 0) msg += `，跳过 ${json.skipped.length} 篇（已存在）`;
        if (failed.length > 0) msg += `，失败 ${failed.length} 个路径`;
        onToast?.(msg, json.added.length > 0 && failed.length === 0 ? 'success' : 'error');
        setAddExternalOpen(false);
        setExternalPathsText('');
        onRefresh();
      } else {
        setExternalError(json.error || '添加失败');
      }
    } catch {
      setExternalError('网络错误，请重试');
    }
    setAddingExternal(false);
  };

  const handleAddExternal = async () => {
    const paths = externalPathsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (paths.length === 0) {
      setExternalError('请选择文件/文件夹，或粘贴至少一个路径');
      return;
    }
    await addPaths(paths);
  };

  // 调起本机资源管理器对话框选择文件/文件夹
  const pickFromDialog = async (mode: 'file' | 'folder') => {
    if (picking) return;
    setPicking(mode);
    setExternalError('');
    try {
      const res = await fetch('/api/external/picker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({ error: '打开选择对话框失败' }));
      if (json.success && !json.cancelled && json.paths?.length > 0) {
        setExternalPathsText((prev) => (prev.trim() ? prev.trimEnd() + '\n' : '') + json.paths.join('\n'));
        await addPaths(json.paths);
      } else if (!json.success) {
        setExternalError(json.error || '打开选择对话框失败');
      }
    } catch {
      setExternalError('打开选择对话框失败');
    }
    setPicking(null);
  };

  const saveExternalTitle = async (clear: boolean) => {
    if (!renameTarget) return;
    setRenaming(true);
    setRenameError('');
    try {
      const res = await fetch('/api/external', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renameTarget.id, customTitle: clear ? '' : renameText }),
      });
      const json = await res.json().catch(() => ({ error: '保存失败' }));
      if (json.success) {
        onToast?.(clear ? '已恢复为原文件名标题' : '显示名已更新', 'success');
        setRenameTarget(null);
        onRefresh();
      } else {
        setRenameError(json.error || '保存失败');
      }
    } catch {
      setRenameError('网络错误，请重试');
    }
    setRenaming(false);
  };

  const removeExternal = async (id: string) => {
    if (!confirm('从索引中移除该文档？不会删除磁盘上的原文件。')) return;
    try {
      const res = await fetch(`/api/external?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({ error: '移除失败' }));
      if (json.success) {
        onToast?.('已从索引移除（原文件保留）', 'success');
        onRefresh();
      } else {
        onToast?.(json.error || '移除失败', 'error');
      }
    } catch {
      onToast?.('移除失败', 'error');
    }
  };

  const needsSlug = createForm?.type === 'category' || createForm?.type === 'project-subdir' || createForm?.type === 'group';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span
          className="sidebar-header-title"
          onClick={onGoHome}
          title="返回首页"
          style={{ cursor: onGoHome ? 'pointer' : 'default' }}
        >
          面试真题知识库
        </span>
        <button className="sidebar-home-btn" onClick={onGoHome} title="返回首页" aria-label="返回首页">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
            <path d="M10 21v-6h4v6" />
          </svg>
        </button>
      </div>

      {/* 分类 */}
      <div className="sidebar-section sidebar-cats">
        <div className="sidebar-section-title">
          <span>分类 ({categories.length})</span>
          <button className="sidebar-add-btn" onClick={() => openForm('category')} title="新建分类" aria-label="新建分类">+</button>
        </div>
        {categories.map((cat) => (
          <div
            key={cat.slug}
            data-sidebar-cat={cat.slug}
            className={`sidebar-cat ${drag.state.drop?.category === cat.slug ? 'drag-target-cat' : ''}`}
            onPointerDown={drag.onPointerDown}
          >
            <button
              className={`sidebar-item ${selectedCategory === cat.slug && !selectedFile ? 'active' : ''} ${selectedCategory === cat.slug && selectedFile ? 'category-current' : ''}`}
              onClick={() => {
                onSelectCategory(cat.slug);
                toggleCategory(cat.slug);
              }}
              title={cat.name}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cat.name}
              </span>
              <span className="badge">{cat.questionCount}</span>
            </button>
            {expandedCategories.has(cat.slug) && (
              <div>
                {cat.questions.length > 0 && cat.questions.map((q) => (
                  <button
                    key={q.filename}
                    data-sidebar-draggable=""
                    data-cat-slug={cat.slug}
                    data-filename={q.filename}
                    data-title={q.title}
                    className={`sidebar-item sidebar-sub ${selectedFile === q.filename && selectedCategory === cat.slug ? 'active-question' : ''} ${drag.state.item?.filename === q.filename && drag.state.item?.category === cat.slug ? 'drag-source' : ''}`}
                    onClick={() => onSelectQuestion(cat.slug, q.filename)}
                    title={q.title}
                  >
                    <span className="sidebar-question-index">{q.filename.slice(0, 3)}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.title}
                    </span>
                  </button>
                ))}
                <button
                  className="sidebar-item sidebar-sub sidebar-new-doc"
                  onClick={() => openForm('category-doc', cat.slug)}
                  title="新建文档"
                >
                  <span className="sidebar-question-index">+</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#999' }}>
                    新建题目...
                  </span>
                </button>
              </div>
            )}
            {drag.state.drop?.category === cat.slug && (
              <div className="sidebar-drop-indicator" style={{ top: drag.state.drop.indicatorTop }} />
            )}
          </div>
        ))}
      </div>

      {/* 标签 */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">标签 ({tags.length})</div>
        {tags.slice(0, 20).map((tag) => (
          <div
            key={tag.name}
            className="sidebar-item" style={{ fontSize: 12, cursor: "pointer" }} onClick={() => onSelectTag?.(tag.name)}
            title={`${tag.name} — ${tag.questions.length} 道题目`}
          >
            <span># {tag.name}</span>
            <span className="badge">{tag.questions.length}</span>
          </div>
        ))}
        {tags.length > 20 && (
          <div className="sidebar-item sidebar-more">还有 {tags.length - 20} 个标签...</div>
        )}
      </div>

      {/* project 伞形区块：普通子目录 */}
      {projectSubdirs.filter(s => !s.isGroup).length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            <span>project ({projectSubdirs.filter(s => !s.isGroup).length})</span>
            <button className="sidebar-add-btn" onClick={() => openForm('project-subdir')} title="新建 project 子目录" aria-label="新建子目录">+</button>
          </div>
          {projectSubdirs.filter(s => !s.isGroup).map((subdir) => (
            <div key={subdir.slug}>
              <button
                className="sidebar-item"
                onClick={() => {
                  onSelectProjectSubdir?.(subdir.slug);
                  setExpandedProjectSubdirs((prev) => {
                    const next = new Set(prev);
                    if (next.has(subdir.slug)) next.delete(subdir.slug);
                    else next.add(subdir.slug);
                    return next;
                  });
                }}
                title={subdir.slug}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {subdir.slug}
                </span>
                <span className="badge">{subdir.docs.length}</span>
              </button>
              {expandedProjectSubdirs.has(subdir.slug) && subdir.docs.length > 0 && (
                <div>
                  {subdir.docs.map((doc) => (
                    <button
                      key={`${subdir.slug}/${doc.filename}`}
                      className="sidebar-item sidebar-sub"
                      onClick={() => onSelectProgram?.(subdir.slug, doc.filename)}
                      title={doc.title}
                    >
                      <span className="sidebar-question-index">{doc.filename.slice(0, 3)}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 分组：每个分组作为独立区块 */}
      {projectSubdirs.filter(s => s.isGroup).map((subdir) => (
        <div className="sidebar-section" key={subdir.slug}>
          <div className="sidebar-section-title">
            <button
              className="sidebar-group-title"
              onClick={() => {
                onSelectProjectSubdir?.(subdir.slug);
                setExpandedProjectSubdirs((prev) => {
                  const next = new Set(prev);
                  if (next.has(subdir.slug)) next.delete(subdir.slug);
                  else next.add(subdir.slug);
                  return next;
                });
              }}
              title={subdir.slug}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subdir.slug}
              </span>
              <span className="badge">{subdir.docs.length}</span>
            </button>
            <button className="sidebar-add-btn" onClick={() => openForm('project-doc', subdir.slug)} title="新建文档" aria-label="新建文档">+</button>
          </div>
          {expandedProjectSubdirs.has(subdir.slug) && subdir.docs.length > 0 && (
            <div>
              {subdir.docs.map((doc) => (
                <button
                  key={`${subdir.slug}/${doc.filename}`}
                  className="sidebar-item sidebar-sub"
                  onClick={() => onSelectProgram?.(subdir.slug, doc.filename)}
                  title={doc.title}
                >
                  <span className="sidebar-question-index">{doc.filename.slice(0, 3)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 外部文档：本机任意位置 md 的路径索引 */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectExternalList?.()}
            title="查看外部文档列表"
          >
            外部文档 ({externalDocs.length})
          </span>
          <button className="sidebar-add-btn" onClick={() => { setExternalError(''); setAddExternalOpen(true); }} title="索引本机外部 md 文档" aria-label="添加外部文档">+</button>
        </div>
        {externalDocs.length === 0 && (
          <div className="sidebar-item" style={{ fontSize: 12, color: '#999', cursor: 'default' }}>
            暂无外部文档，点击 + 添加
          </div>
        )}
        {externalDocs.map((doc) => (
          <div key={doc.id}>
            <div
              className={`sidebar-item ${doc.missing ? 'external-missing' : ''}`}
              style={{ fontSize: 13, cursor: 'pointer' }}
              onClick={() => {
                if (doc.missing) onExternalMissing?.(doc.path);
                else onSelectExternalDoc?.(doc.id);
              }}
              title={doc.missing
                ? `索引失效，原位置：${doc.path}`
                : doc.customTitle
                ? `显示名：${doc.title}\n原文件名标题：${doc.originalTitle}\n${doc.path}`
                : doc.path}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.missing ? '⚠ ' : ''}{doc.title}
              </span>
              {doc.missing && <span className="badge">失效</span>}
              <span
                className="external-remove"
                onClick={(e) => { e.stopPropagation(); setRenameText(doc.customTitle); setRenameError(''); setRenameTarget(doc); }}
                title="设置自命名标题（不改动原文件）"
              >
                ✎
              </span>
              <span
                className="external-remove"
                onClick={(e) => { e.stopPropagation(); removeExternal(doc.id); }}
                title="从索引移除（不删除原文件）"
              >
                ×
              </span>
            </div>
            {doc.customTitle && !doc.missing && (
              <div className="external-path" style={{ color: '#8c7e9d' }}>原文件名标题：{doc.originalTitle}</div>
            )}
            {doc.missing && (
              <div className="external-path">{doc.path}</div>
            )}
          </div>
        ))}
      </div>

      {/* 快捷操作 */}
      <div className="sidebar-section" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className="sidebar-item sidebar-new-question" onClick={onNewQuestion}>
          + 新建题目
        </button>
        <button
          className="sidebar-item sidebar-new-question"
          onClick={() => openForm('group')}
          style={{ fontSize: 12 }}
        >
          + 新建分组
        </button>
      </div>

      {/* 添加外部文档弹窗 */}
      {addExternalOpen && (
        <div className="sidebar-modal-overlay" onClick={() => !addingExternal && !picking && setAddExternalOpen(false)}>
          <div className="sidebar-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">索引外部 MD 文档</div>
            <div className="sidebar-modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  className="btn btn-small btn-primary"
                  onClick={() => pickFromDialog('file')}
                  disabled={!!picking || addingExternal}
                >
                  {picking === 'file' ? '等待选择…' : '选择文件…'}
                </button>
                <button
                  className="btn btn-small btn-primary"
                  onClick={() => pickFromDialog('folder')}
                  disabled={!!picking || addingExternal}
                >
                  {picking === 'folder' ? '等待选择…' : '选择文件夹…'}
                </button>
                {picking && (
                  <span style={{ fontSize: 12, color: '#1971c2', alignSelf: 'center' }}>
                    请在弹出的资源管理器窗口中完成选择
                  </span>
                )}
              </div>
              <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 4 }}>
                或手动粘贴 .md 文件/文件夹完整路径，每行一个（文件夹会递归扫描其中的 .md）
              </label>
              <textarea
                className="sidebar-modal-input sidebar-modal-textarea"
                value={externalPathsText}
                onChange={(e) => setExternalPathsText(e.target.value)}
                placeholder={'D:\\notes\\设计文档.md\nD:\\blog\\posts'}
                autoFocus
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                文档保留在原位置，本项目仅记录路径。文件被移动或重命名后索引将失效并提示原位置。
              </div>
            </div>
            {externalError && (
              <div style={{ color: '#e03131', fontSize: 12, marginBottom: 8 }}>{externalError}</div>
            )}
            <div className="sidebar-modal-actions">
              <button className="btn btn-small btn-secondary" onClick={() => setAddExternalOpen(false)} disabled={addingExternal || !!picking}>取消</button>
              <button className="btn btn-small btn-primary" onClick={handleAddExternal} disabled={addingExternal || !!picking || !externalPathsText.trim()}>
                {addingExternal ? '扫描中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 外部文档自命名标题弹窗 */}
      {renameTarget && (
        <div className="sidebar-modal-overlay" onClick={() => !renaming && setRenameTarget(null)}>
          <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">自命名标题</div>
            <div className="sidebar-modal-body">
              <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 4 }}>
                仅改变本项目中的显示名，不改动原文件名与内容
              </label>
              <input
                className="sidebar-modal-input"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveExternalTitle(false); }}
                placeholder={`原文件名标题：${renameTarget.originalTitle}`}
                autoFocus
              />
              {renameTarget.path && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 4, wordBreak: 'break-all' }}>{renameTarget.path}</div>
              )}
            </div>
            {renameError && (
              <div style={{ color: '#e03131', fontSize: 12, marginBottom: 8 }}>{renameError}</div>
            )}
            <div className="sidebar-modal-actions">
              {renameTarget.customTitle && (
                <button className="btn btn-small btn-danger" onClick={() => saveExternalTitle(true)} disabled={renaming}>
                  恢复原名
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-small btn-secondary" onClick={() => setRenameTarget(null)} disabled={renaming}>取消</button>
              <button className="btn btn-small btn-primary" onClick={() => saveExternalTitle(false)} disabled={renaming}>
                {renaming ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {createForm && (
        <div className="sidebar-modal-overlay" onClick={closeForm}>
          <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">
              {createForm.type === 'category' ? '新建分类' :
               createForm.type === 'project-subdir' ? '新建 project 子目录' :
               createForm.type === 'group' ? '新建分组' :
               '新建文档'}
            </div>
            <div className="sidebar-modal-body">
              {needsSlug && (
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>目录名</label>
                  <input
                    className="sidebar-modal-input"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                    placeholder={slugify(formName) || 'english-slug'}
                  />
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 2 }}>
                  {needsSlug ? '显示名' : '标题'}
                </label>
                <input
                  className="sidebar-modal-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder={needsSlug ? '显示名称' : '文档标题'}
                  autoFocus
                />
              </div>
            </div>
            {formError && (
              <div style={{ color: '#e03131', fontSize: 12, marginBottom: 8 }}>{formError}</div>
            )}
            <div className="sidebar-modal-actions">
              <button className="btn btn-small btn-secondary" onClick={closeForm} disabled={creating}>取消</button>
              <button className="btn btn-small btn-primary" onClick={handleSubmit} disabled={creating || !formName.trim()}>
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽幽灵：portal 到 body，transform 由 hook 每帧直接更新（不走 React 渲染） */}
      {drag.state.phase !== 'idle' && drag.state.item && createPortal(
        <div
          ref={drag.ghostRef}
          className="sidebar-drag-ghost"
          style={{
            left: 0,
            top: 0,
            transform: `translate3d(${drag.state.ghost?.x ?? 0}px, ${drag.state.ghost?.y ?? 0}px, 0) scale(1.04)`,
          }}
        >
          <span className="sidebar-question-index">{drag.state.item.chip}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {drag.state.item.title}
          </span>
        </div>,
        document.body,
      )}
    </aside>
  );
}
