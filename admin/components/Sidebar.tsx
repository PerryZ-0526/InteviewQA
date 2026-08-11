'use client';

import { useEffect, useState } from 'react';
import { CategoryInfo, TagInfo, ProjectSubdir } from '@/lib/types';

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
  onNewQuestion: () => void;
  onRefresh: () => void;
  refreshKey?: number;
}

interface CreateForm {
  type: 'category' | 'project-subdir' | 'category-doc' | 'project-doc' | 'section';
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
  onNewQuestion,
  onRefresh,
  refreshKey = 0,
}: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedProjectSubdirs, setExpandedProjectSubdirs] = useState<Set<string>>(new Set());
  const [projectSubdirs, setProjectSubdirs] = useState<ProjectSubdir[]>([]);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/project');
        const json = await res.json();
        if (json.success) setProjectSubdirs(json.data || []);
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
      } else if (createForm.type === 'section') {
        const slug = formSlug.trim() || slugify(formName);
        res = await fetch('/api/sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, displayName: formName.trim() }),
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

  const needsSlug = createForm?.type === 'category' || createForm?.type === 'project-subdir' || createForm?.type === 'section';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        面试真题知识库
      </div>

      {/* 分类 */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span>分类 ({categories.length})</span>
          <button className="sidebar-add-btn" onClick={() => openForm('category')} title="新建分类" aria-label="新建分类">+</button>
        </div>
        {categories.map((cat) => (
          <div key={cat.slug}>
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
                    className={`sidebar-item sidebar-sub ${selectedFile === q.filename && selectedCategory === cat.slug ? 'active-question' : ''}`}
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

      {/* project 文档 */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span>project ({projectSubdirs.length})</span>
          <button className="sidebar-add-btn" onClick={() => openForm('project-subdir')} title="新建子目录" aria-label="新建子目录">+</button>
        </div>
        {projectSubdirs.map((subdir) => (
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
            {expandedProjectSubdirs.has(subdir.slug) && (
              <div>
                {subdir.docs.length > 0 && subdir.docs.map((doc) => (
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
                <button
                  className="sidebar-item sidebar-sub sidebar-new-doc"
                  onClick={() => openForm('project-doc', subdir.slug)}
                  title="新建文档"
                >
                  <span className="sidebar-question-index">+</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#999' }}>
                    新建文档...
                  </span>
                </button>
              </div>
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
          onClick={() => openForm('section')}
          style={{ fontSize: 12 }}
        >
          + 新建分组
        </button>
      </div>

      {/* Create form modal */}
      {createForm && (
        <div className="sidebar-modal-overlay" onClick={closeForm}>
          <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">
              {createForm.type === 'category' ? '新建分类' :
               createForm.type === 'project-subdir' ? '新建 project 子目录' :
               createForm.type === 'section' ? '新建分组' :
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
    </aside>
  );
}
