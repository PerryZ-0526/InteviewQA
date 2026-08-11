'use client';

import { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import GenerateForm from '@/components/GenerateForm';
import DocumentEditor from '@/components/DocumentEditor';
import RandomQuestion from '@/components/RandomQuestion';
import EditorToolbar from '@/components/EditorToolbar';
import LogViewer from '@/components/LogViewer';
import AnnotationPanel from '@/components/AnnotationPanel';
import ProjectDocumentView from '@/components/ProjectDocumentView';
import CreateEmptyModal from '@/components/CreateEmptyModal';
import AIFloat from '@/components/AIFloat';
import BackToTop from '@/components/BackToTop';
import TocFloat from '@/components/TocFloat';
import TagViewer from '@/components/TagViewer';
import { CategoryInfo, TagInfo } from '@/lib/types';

export default function Home() {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProjectSubdir, setSelectedProjectSubdir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [view, setView] = useState<'browse' | 'new' | 'edit' | 'random' | 'tag' | 'project-doc' | 'new-empty'>('browse');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [projectSubdir, setProjectSubdir] = useState<string | null>(null);
  const [projectFilename, setProjectFilename] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [projectSubdirs, setProjectSubdirs] = useState<{ slug: string; name: string; docs: { filename: string; title: string }[] }[]>([]);
  const [projectStats, setProjectStats] = useState<{ subdirs: number; docs: number }>({ subdirs: 0, docs: 0 });

  // Track previous state for back navigation from random mode
  const prevStateRef = useRef<{
    view: 'browse' | 'edit' | 'tag' | 'project-doc' | 'new-empty';
    selectedCategory: string | null;
    selectedFile: string | null;
    editContent: string;
  }>({ view: 'browse', selectedCategory: null, selectedFile: null, editContent: '' });

  const loadCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const json = await res.json();
      if (json.success) setCategories(json.data);
    } catch (e) {
      console.error('Failed to load categories:', e);
    }
  };

  const loadTags = async () => {
    try {
      const res = await fetch('/api/tags');
      const json = await res.json();
      if (json.success) setTags(json.data);
    } catch (e) {
      console.error('Failed to load tags:', e);
    }
  };

  const loadProjectStats = async () => {
    try {
      const res = await fetch('/api/project');
      const json = await res.json();
      if (json.success) {
        const data = json.data as { slug: string; name: string; docs: { filename: string; title: string }[] }[];
        setProjectSubdirs(data);
        setProjectStats({
          subdirs: data.length,
          docs: data.reduce((s, d) => s + d.docs.length, 0),
        });
      }
    } catch {}
  };

  useEffect(() => {
    loadCategories();
    loadTags();
    loadProjectStats();
  }, []);

  const showToast = (msg: string, type: string = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const openQuestion = async (category: string, filename: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/categories/${category}/${filename}`);
      const json = await res.json();
      if (json.success) {
        setSelectedCategory(category);
        setSelectedFile(filename);
        setEditContent(json.data);
        setView('edit');
        // Save state for potential back from random
        prevStateRef.current = { view: 'edit', selectedCategory: category, selectedFile: filename, editContent: json.data };
      }
    } catch (e) {
      showToast('加载题目失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveEdit = async (content: string) => {
    if (!selectedCategory || !selectedFile) return false;
    try {
      const res = await fetch(`/api/categories/${selectedCategory}/${selectedFile}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (json.success) {
        setEditContent(content);
        // Update sidebar title from H1 in content
        const h1Match = content.match(/^#\s+(.+)/m);
        if (h1Match) {
          const newTitle = h1Match[1].trim();
          setCategories((prev) =>
            prev.map((c) => {
              if (c.slug !== selectedCategory) return c;
              return {
                ...c,
                questions: c.questions.map((q) =>
                  q.filename === selectedFile ? { ...q, title: newTitle } : q
                ),
              };
            })
          );
        }
        return true;
      } else {
        showToast('保存失败: ' + json.error, 'error');
        return false;
      }
    } catch (e) {
      showToast('保存失败', 'error');
      return false;
    }
  };

  const onGenerated = async (filePath: string, content: string) => {
    const parts = filePath.replace(/\\/g, '/').split('/');
    const cat = parts[1] || '';
    const filename = parts[2] || '';
    setSelectedCategory(cat);
    setSelectedFile(filename);
    setEditContent(content);
    setView('edit');
    showToast('题目生成成功！', 'success');
    await loadCategories();
    await loadTags();
  };

  const deleteQuestion = async () => {
    if (!selectedCategory || !selectedFile) return;
    if (deleting) return;
    if (!confirm(`确认删除 "${selectedFile}"？此操作不可撤销。`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/categories/${selectedCategory}/${selectedFile}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        setSelectedFile(null);
        setView('browse');
        showToast('删除成功！', 'success');
        await loadCategories();
        await loadTags();
      } else {
        showToast('删除失败: ' + json.error, 'error');
      }
    } catch (e: any) {
      showToast('删除失败: ' + e.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Pick a random question from all categories
  const openRandom = async () => {
    // Flatten all questions
    const allQuestions: { category: string; filename: string }[] = [];
    for (const cat of categories) {
      for (const q of cat.questions) {
        allQuestions.push({ category: cat.slug, filename: q.filename });
      }
    }

    if (allQuestions.length === 0) {
      showToast('题库为空，请先添加题目', 'error');
      return;
    }

    // Save current state before jumping to random
    const prevView = (view === 'random' || view === 'new') ? 'browse' : view;
    prevStateRef.current = {
      view: prevView,
      selectedCategory,
      selectedFile,
      editContent,
    };

    // Pick random
    const idx = Math.floor(Math.random() * allQuestions.length);
    const picked = allQuestions[idx];

    try {
      setLoading(true);
      const res = await fetch(`/api/categories/${picked.category}/${picked.filename}`);
      const json = await res.json();
      if (json.success) {
        setSelectedCategory(picked.category);
        setSelectedFile(picked.filename);
        setEditContent(json.data);
        setView('random');
      } else {
        showToast('加载失败', 'error');
      }
    } catch (e) {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Back from random mode to previous state
  const openTag = (tagName: string) => {
    prevStateRef.current = {
      view: (view === 'new' || view === 'new-empty') ? 'browse' : (view === 'random' || view === 'tag' || view === 'project-doc' ? 'browse' : view),
      selectedCategory,
      selectedFile,
      editContent,
    };
    setSelectedTag(tagName);
    setView('tag');
  };

  const openProjectDoc = (subdir: string, filename: string) => {
    prevStateRef.current = {
      view: (view === 'new' || view === 'new-empty') ? 'browse' : (view === 'random' || view === 'tag' || view === 'project-doc' ? 'browse' : view),
      selectedCategory,
      selectedFile,
      editContent,
    };
    setProjectSubdir(subdir);
    setProjectFilename(filename);
    setView('project-doc');
  };

  const backFromProjectDoc = () => {
    const prev = prevStateRef.current;
    setSelectedCategory(prev.selectedCategory);
    setSelectedFile(prev.selectedFile);
    setEditContent(prev.editContent);
    setView(prev.view);
  };

  const backFromRandom = () => {
    const prev = prevStateRef.current;
    setSelectedCategory(prev.selectedCategory);
    setSelectedFile(prev.selectedFile);
    setEditContent(prev.editContent);
    setView(prev.view);
  };

  const currentCategoryName = categories.find((c) => c.slug === selectedCategory)?.name || selectedCategory;

  return (
    <div id="app-root">
      <Sidebar
        categories={categories}
        tags={tags}
        selectedCategory={selectedCategory}
        selectedFile={selectedFile}
        refreshKey={refreshKey}
        onRefresh={async () => { await loadCategories(); await loadTags(); await loadProjectStats(); setRefreshKey(k => k + 1); }}
        onSelectCategory={(slug) => {
          setSelectedCategory(slug);
          setSelectedProjectSubdir(null);
          setSelectedFile(null);
          setView('browse');
        }}
        onSelectProjectSubdir={(subdir) => {
          setSelectedProjectSubdir(subdir);
          setSelectedCategory(null);
          setSelectedFile(null);
          setView('browse');
        }}
        onSelectQuestion={(cat, filename) => openQuestion(cat, filename)}
        onSelectTag={openTag}
        onSelectProgram={openProjectDoc}
        onNewQuestion={() => setView('new')}
      />

      <div className="main">
        <header className="header">
          <div>
            <h1>
              {view === 'new'
                ? '新建题目'
                : view === 'random'
                ? '随机一题'
                : view === 'edit'
                ? selectedFile || '编辑'
                : view === 'project-doc'
                ? projectFilename || '文档'
                : view === 'browse' && selectedProjectSubdir
                ? selectedProjectSubdir
                : currentCategoryName || '面试真题知识库'}
            </h1>
            {view === 'edit' && selectedFile && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {currentCategoryName} / {selectedFile}
              </span>
            )}
            {view === 'random' && selectedFile && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {currentCategoryName} / {selectedFile}
              </span>
            )}
            {view === 'browse' && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {selectedCategory ? `${currentCategoryName} — 题目列表` :
                 selectedProjectSubdir ? `${selectedProjectSubdir} — 文档列表` :
                 '选择一个分类或分组查看'}
              </span>
            )}
          </div>
          <div className="header-actions">
            {view === 'edit' && (
              <button className="btn btn-danger" onClick={deleteQuestion}>
                删除此题
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setShowLogs(true)} title="查看操作日志">
              日志
            </button>
            <button
              className="btn btn-secondary"
              onClick={openRandom}
              title="随机抽取一道题目进行练习"
            >
              随机一题
            </button>
            <button className="btn btn-secondary" onClick={() => setView('new-empty')} title="创建空白的题目文件，不调用 AI 生成">
              新建空文档
            </button>
            <button className="btn btn-primary" onClick={() => setView('new')}>
              + 新建题目
            </button>
          </div>
        </header>

        {(view === 'edit' || view === 'random' || view === 'project-doc') && <EditorToolbar />}

        <div className="content">
          {view === 'browse' && selectedCategory && (
            <BrowseView
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectQuestion={openQuestion}
              loading={loading}
            />
          )}

          {view === 'browse' && selectedProjectSubdir && (
            <ProjectBrowseView
              subdirs={projectSubdirs}
              selectedSubdir={selectedProjectSubdir}
              onSelectDoc={(subdir, filename) => openProjectDoc(subdir, filename)}
            />
          )}

          {view === 'edit' && editContent && selectedFile && (
            <DocumentEditor
              key={selectedFile}
              markdown={editContent}
              filename={selectedFile}
              onSave={saveEdit}
            />
          )}

          {view === 'random' && editContent && selectedCategory && selectedFile && (
            <RandomQuestion
              key={selectedFile}
              markdown={editContent}
              filename={selectedFile}
              category={currentCategoryName || selectedCategory}
              onSave={saveEdit}
              onBack={backFromRandom}
            />
          )}

          {view === 'tag' && selectedTag && (
            <TagViewer
              tagName={selectedTag}
              onBack={backFromRandom}
              onOpenQuestion={(cat, filename) => openQuestion(cat, filename)}
            />
          )}

          {view === 'project-doc' && projectSubdir && projectFilename && (
            <ProjectDocumentView
              subdir={projectSubdir}
              filename={projectFilename}
              onBack={backFromProjectDoc}
              onSaved={() => setRefreshKey(k => k + 1)}
            />
          )}

          {view === 'new' && (
            <GenerateForm
              categories={categories}
              tags={tags}
              onGenerated={onGenerated}
              onCancel={() => setView('browse')}
              onGeneratingChange={setGenerating}
            />
          )}
        </div>

        <div className="status-bar">
          <span>
            {categories.length} 个分类 |{' '}
            {categories.reduce((sum, c) => sum + c.questionCount, 0)} 道题目 |{' '}
            {tags.length} 个标签
            {' | '}
            {categories.reduce((sum, c) => sum + c.questions.filter(q => q.title.startsWith('✅')).length, 0)} 个✅文档
          </span>
          <span style={{ marginLeft: 32 }}>
            {projectStats.subdirs} 个project |{' '}
            {projectStats.docs} 个project文档
            {' | '}
            0 个其他分组
          </span>
          <span>
            {generating ? (
              <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
                <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5, marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
                正在生成题目...
              </span>
            ) : loading ? '加载中...' : '就绪'}
          </span>
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.msg}
        </div>
      )}

      {view === 'new-empty' && (
        <CreateEmptyModal
          categories={categories}
          onCancel={() => setView('browse')}
          onCreated={async (filePath, content) => {
            const parts = filePath.replace(/\\/g, '/').split('/');
            const cat = parts[1] || '';
            const filename = parts[2] || '';
            setSelectedCategory(cat);
            setSelectedFile(filename);
            setEditContent(content);
            setView('edit');
            showToast('空文档创建成功！', 'success');
            await loadCategories();
            await loadTags();
          }}
        />
      )}

      {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}

      {(view === 'edit' || view === 'random') && selectedCategory && selectedFile && (
        <AnnotationPanel
          category={selectedCategory}
          filename={selectedFile}
          onSelectQuote={(quote) => window.dispatchEvent(new CustomEvent('select-annotation-quote', { detail: { quote } }))}
        />
      )}

      {view === 'project-doc' && projectSubdir && projectFilename && (
        <AnnotationPanel
          category={projectSubdir}
          filename={projectFilename}
          context="project"
          onSelectQuote={(quote) => window.dispatchEvent(new CustomEvent('select-annotation-quote', { detail: { quote } }))}
        />
      )}

      {(view === 'edit' || view === 'random' || view === 'project-doc') && (
        <>
          <AIFloat />
          <TocFloat />
          <BackToTop />
        </>
      )}
    </div>
  );
}

function BrowseView({
  categories,
  selectedCategory,
  onSelectQuestion,
  loading,
}: {
  categories: CategoryInfo[];
  selectedCategory: string | null;
  onSelectQuestion: (cat: string, filename: string) => void;
  loading: boolean;
}) {
  const category = categories.find((c) => c.slug === selectedCategory);

  if (!selectedCategory) {
    return (
      <div className="empty-state">
        <h3>选择一个分类</h3>
        <p>从左侧边栏选择分类查看题目列表，或点击「新建题目」创建新题目</p>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="empty-state">
        <h3>分类不存在</h3>
        <p>请选择其他分类</p>
      </div>
    );
  }

  if (category.questions.length === 0) {
    return (
      <div className="empty-state">
        <h3>{category.name} — 暂无题目</h3>
        <p>该分类下还没有题目，点击「新建题目」开始创建</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>
        {category.name} — {category.questions.length} 道题目
      </div>
      {loading && (
        <div className="loading-overlay" style={{ padding: 20 }}>
          <div className="loading-spinner" />
        </div>
      )}
      {category.questions.map((q) => (
        <div
          key={q.filename}
          className="question-list-item"
          onClick={() => onSelectQuestion(selectedCategory, q.filename)}
        >
          <span className="filename">{q.filename}</span>
          <span className="title">{q.title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>打开 →</span>
        </div>
      ))}
    </div>
  );
}

function ProjectBrowseView({
  subdirs,
  selectedSubdir,
  onSelectDoc,
}: {
  subdirs: { slug: string; name: string; docs: { filename: string; title: string }[] }[];
  selectedSubdir: string | null;
  onSelectDoc: (subdir: string, filename: string) => void;
}) {
  const subdir = subdirs.find(s => s.slug === selectedSubdir);
  if (!subdir) return null;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>
        {subdir.name} — {subdir.docs.length} 篇文档
      </div>
      {subdir.docs.length === 0 && (
        <div className="empty-state" style={{ padding: 20 }}>
          <p>暂无文档</p>
        </div>
      )}
      {subdir.docs.map((doc) => (
        <div
          key={doc.filename}
          className="question-list-item"
          onClick={() => onSelectDoc(subdir.slug, doc.filename)}
        >
          <span className="filename">{doc.filename}</span>
          <span className="title">{doc.title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>打开 →</span>
        </div>
      ))}
    </div>
  );
}
