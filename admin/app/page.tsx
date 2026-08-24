'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import GenerateForm from '@/components/GenerateForm';
import DocumentEditor from '@/components/DocumentEditor';
import RandomQuestion from '@/components/RandomQuestion';
import EditorToolbar from '@/components/EditorToolbar';
import LogViewer from '@/components/LogViewer';
import AnnotationPanel from '@/components/AnnotationPanel';
import ProjectDocumentView from '@/components/ProjectDocumentView';
import ExternalDocView from '@/components/ExternalDocView';
import CreateEmptyModal from '@/components/CreateEmptyModal';
import AIFloat from '@/components/AIFloat';
import BackToTop from '@/components/BackToTop';
import TocFloat from '@/components/TocFloat';
import LinkInsertFloat from '@/components/LinkInsertFloat';
import TagViewer from '@/components/TagViewer';
import TabBar from '@/components/TabBar';
import { CategoryInfo, TagInfo, ExternalDocInfo } from '@/lib/types';
import { stripMdText } from '@/lib/stripText';

interface DocTab {
  id: string;
  kind: 'category' | 'random' | 'project' | 'external' | 'form';
  category?: string;
  filename?: string;
  subdir?: string;
  extId?: string;
  label: string;
}

export default function Home() {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProjectSubdir, setSelectedProjectSubdir] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [view, setView] = useState<'browse' | 'new' | 'edit' | 'random' | 'tag' | 'project-doc' | 'new-empty' | 'external-doc'>('browse');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [projectSubdir, setProjectSubdir] = useState<string | null>(null);
  const [projectFilename, setProjectFilename] = useState<string | null>(null);
  const [externalDocId, setExternalDocId] = useState<string | null>(null);
  const [browsingExternal, setBrowsingExternal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorSaveStatus, setEditorSaveStatus] = useState<string>('');
  const [pendingAnchor, setPendingAnchor] = useState<string[] | null>(null);
  // 并发生成计数：多个新建题目标签可同时生成，任一进行中状态栏即显示
  const [generatingCount, setGeneratingCount] = useState(0);
  const generating = generatingCount > 0;
  const [showLogs, setShowLogs] = useState(false);
  const [projectSubdirs, setProjectSubdirs] = useState<{ slug: string; name: string; isGroup?: boolean; docs: { filename: string; title: string; wordCount?: number }[] }[]>([]);
  const [projectStats, setProjectStats] = useState<{ subdirs: number; docs: number; groups: number }>({ subdirs: 0, docs: 0, groups: 0 });
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([]);

  // 多标签：已打开文档的工作集（内存态，刷新即清空；文档内容本身已自动保存到磁盘）
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const tabScrollsRef = useRef<Record<string, number>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Track previous state for back navigation from random mode
  const navSeqRef = useRef(0);
  // 文档内链接跳转：点击总是新开一个标签页，不复用已打开的文档标签
  const linkTabSeqRef = useRef(0);
  const prevStateRef = useRef<{
    view: 'browse' | 'edit' | 'tag' | 'project-doc' | 'new-empty' | 'external-doc' | 'random';
    selectedCategory: string | null;
    selectedFile: string | null;
  }>({ view: 'browse', selectedCategory: null, selectedFile: null });

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
        const data = json.data as { slug: string; name: string; isGroup?: boolean; docs: { filename: string; title: string; wordCount?: number }[] }[];
        setProjectSubdirs(data);
        const normal = data.filter(d => !d.isGroup);
        setProjectStats({
          subdirs: normal.length,
          docs: normal.reduce((s, d) => s + d.docs.length, 0),
          groups: data.filter(d => d.isGroup).length,
        });
      }
    } catch {}
  };

  const loadExternalDocs = async () => {
    try {
      const res = await fetch('/api/external');
      const json = await res.json();
      if (json.success) setExternalDocs(json.data);
    } catch {}
  };

  useEffect(() => {
    loadCategories();
    loadTags();
    loadProjectStats();
    loadExternalDocs();
  }, []);

  const showToast = (msg: string, type: string = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ---- 多标签管理 ----
  const DOC_VIEWS = ['edit', 'random', 'project-doc', 'external-doc', 'new'] as const;

  const kindToView = (kind: DocTab['kind']) =>
    kind === 'category' ? 'edit' : kind === 'project' ? 'project-doc' : kind === 'external' ? 'external-doc' : kind === 'form' ? 'new' : 'random';

  const formSeqRef = useRef(0);

  // 标签页采用 MRU 排序：新开的标签插到最左侧；重开已打开文档时将其移到最前
  const addTabToFront = (tab: DocTab) => {
    setTabs((prev) => [tab, ...prev.filter((t) => t.id !== tab.id)]);
  };

  // 新建题目表单作为一个独立标签（保持挂载，草稿内容切换不丢失）
  const openFormTab = () => {
    const existingForms = tabs.filter((t) => t.kind === 'form').length;
    const tab: DocTab = {
      id: `form:${++formSeqRef.current}`,
      kind: 'form',
      label: existingForms > 0 ? `新建题目 ${existingForms + 1}` : '新建题目',
    };
    addTabToFront(tab);
    activateTab(tab);
  };

  const saveActiveTabScroll = () => {
    if (activeTabId && contentRef.current) {
      tabScrollsRef.current[activeTabId] = contentRef.current.scrollTop;
    }
  };

  const activateTab = (tab: DocTab) => {
    saveActiveTabScroll();
    setActiveTabId(tab.id);
    setSelectedCategory(tab.category ?? null);
    setSelectedFile(tab.filename ?? null);
    setProjectSubdir(tab.subdir ?? null);
    setProjectFilename(tab.kind === 'project' ? (tab.filename ?? null) : null);
    setExternalDocId(tab.extId ?? null);
    setPendingAnchor(null);
    setView(kindToView(tab.kind));
  };

  // 切到浏览/新建等非文档视图：保存当前标签滚动位置并取消激活
  const deactivateTab = () => {
    saveActiveTabScroll();
    setActiveTabId(null);
  };

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    delete tabScrollsRef.current[id];
    setTabContents((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeTabId === id) {
      if (newTabs.length === 0) {
        setActiveTabId(null);
        setView('browse');
      } else {
        // 直接激活相邻标签（不保存已关闭标签的滚动位置）
        const next = newTabs[Math.min(idx, newTabs.length - 1)];
        setActiveTabId(next.id);
        setSelectedCategory(next.category ?? null);
        setSelectedFile(next.filename ?? null);
        setProjectSubdir(next.subdir ?? null);
        setProjectFilename(next.kind === 'project' ? (next.filename ?? null) : null);
        setExternalDocId(next.extId ?? null);
        setPendingAnchor(null);
        setView(kindToView(next.kind));
      }
    }
  };

  const closeActiveTab = () => {
    if (activeTabId) closeTab(activeTabId);
  };

  // 一键关闭全部标签：清空工作集并回到浏览视图（文档内容已由编辑器自动保存，草稿标签同单关行为不拦截）
  const closeAllTabs = () => {
    if (tabs.length === 0) return;
    tabScrollsRef.current = {};
    setTabContents({});
    setTabs([]);
    setActiveTabId(null);
    setPendingAnchor(null);
    setView('browse');
  };

  // 切换标签后直接恢复滚动位置（无平滑动画）
  useLayoutEffect(() => {
    if (!activeTabId || !contentRef.current) return;
    if (!DOC_VIEWS.includes(view as (typeof DOC_VIEWS)[number])) return;
    contentRef.current.scrollTop = tabScrollsRef.current[activeTabId] || 0;
  }, [activeTabId, view]);

  const openQuestion = async (category: string, filename: string) => {
    const tabId = `cat:${category}:${filename}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      addTabToFront(existing);
      activateTab(existing);
      return;
    }
    // 导航序号：只应用最后一次请求的结果，防止慢的旧请求把界面跳回之前点击的文档
    const seq = ++navSeqRef.current;
    try {
      setLoading(true);
      const res = await fetch(`/api/categories/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`);
      const json = await res.json();
      if (seq !== navSeqRef.current) return;
      if (json.success) {
        const label = categories.find((c) => c.slug === category)?.questions.find((q) => q.filename === filename)?.title || filename;
        const tab: DocTab = { id: tabId, kind: 'category', category, filename, label };
        setTabContents((prev) => ({ ...prev, [tabId]: json.data }));
        addTabToFront(tab);
        activateTab(tab);
      }
    } catch (e) {
      if (seq !== navSeqRef.current) return;
      showToast('加载题目失败', 'error');
    } finally {
      if (seq === navSeqRef.current) setLoading(false);
    }
  };

  // ---- 拖拽移动题目（跨分类 / 同分类重排） ----

  // 移动成功后重映射受影响的已打开标签（源重排、目标 shift、被移文档三类改名），
  // 并静默重取内容（服务端已改写其导航/内部引用）。
  const remapTabsAfterMove = (json: {
    moved: { from: { category: string; filename: string }; to: { category: string; filename: string } };
    sourceRenames: Record<string, string>;
    targetRenames: Record<string, string>;
  }) => {
    const { moved, sourceRenames, targetRenames } = json;
    const map = new Map<string, { cat: string; file: string }>();
    const key = (c: string, f: string) => `${c}\u0000${f}`;
    for (const [o, n] of Object.entries(sourceRenames)) map.set(key(moved.from.category, o), { cat: moved.from.category, file: n });
    for (const [o, n] of Object.entries(targetRenames)) map.set(key(moved.to.category, o), { cat: moved.to.category, file: n });
    map.set(key(moved.from.category, moved.from.filename), { cat: moved.to.category, file: moved.to.filename });

    const touched: { oldId: string; newId: string; newCat: string; newFile: string }[] = [];
    const newTabs = tabs.map((t) => {
      if (t.kind !== 'category' && t.kind !== 'random') return t;
      const parts = t.id.split(':');
      // cat:<c>:<f> 或 cat:<c>:<f>:<seq>（文档内链接新开的标签带序号后缀）
      const hit = map.get(key(parts[1], parts[2]));
      if (!hit) return t;
      const rest = parts.slice(3).join(':');
      const newId = `${parts[0]}:${hit.cat}:${hit.file}${rest ? ':' + rest : ''}`;
      touched.push({ oldId: t.id, newId, newCat: hit.cat, newFile: hit.file });
      return { ...t, id: newId, category: hit.cat, filename: hit.file };
    });
    if (touched.length === 0) return;

    setTabs(newTabs);
    setTabContents((prev) => {
      const next = { ...prev };
      for (const t of touched) {
        if (prev[t.oldId] != null) {
          next[t.newId] = prev[t.oldId];
          delete next[t.oldId];
        }
      }
      return next;
    });
    for (const t of touched) {
      const s = tabScrollsRef.current[t.oldId];
      if (s != null) {
        tabScrollsRef.current[t.newId] = s;
        delete tabScrollsRef.current[t.oldId];
      }
    }
    if (activeTabId) {
      const hit = touched.find((t) => t.oldId === activeTabId);
      if (hit) {
        setActiveTabId(hit.newId);
        setSelectedCategory(hit.newCat);
        setSelectedFile(hit.newFile);
      }
    }
    // 静默重取受影响标签内容（编辑器按 key 重挂载，不会与自动保存竞争旧路径）
    for (const t of touched) {
      fetch(`/api/categories/${encodeURIComponent(t.newCat)}/${encodeURIComponent(t.newFile)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.success) setTabContents((prev) => ({ ...prev, [t.newId]: j.data }));
        })
        .catch(() => {});
    }
  };

  const handleMoveQuestion = async (fromCat: string, filename: string, toCat: string, toIndex: number) => {
    // 客户端 no-op 检测（同分类且落点等于原位；拖拽 hook 已过滤该情况，此处兜底）
    const srcCat = categories.find((c) => c.slug === fromCat);
    const originalIndex = srcCat?.questions.findIndex((q) => q.filename === filename) ?? -1;
    if (originalIndex < 0) return;
    if (fromCat === toCat && toIndex === originalIndex) {
      showToast('已在原位，无需移动', 'info');
      return;
    }

    // 乐观更新：先移动列表（FLIP 动画基于本次渲染），API 失败时重新加载回滚
    setCategories((prev) => reorderCategories(prev, fromCat, filename, toCat, toIndex));

    try {
      const res = await fetch('/api/categories/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromCategory: fromCat, filename, toCategory: toCat, toIndex }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '移动失败');
      if (json.noop) {
        await loadCategories();
        return;
      }
      remapTabsAfterMove(json);
      await loadCategories();
      await loadTags();
      showToast(`已移动到 ${toCat}`, 'success');
    } catch (e: any) {
      await loadCategories();
      showToast('移动失败: ' + (e?.message || '未知错误'), 'error');
    }
  };

  // target 由发起保存的编辑器捕获其所属文档，避免切换文档后延迟保存写到当前选中的其他文件
  const saveEdit = async (content: string, target?: { category: string; filename: string }) => {
    const cat = target?.category ?? selectedCategory;
    const file = target?.filename ?? selectedFile;
    if (!cat || !file) return false;
    try {
      const res = await fetch(`/api/categories/${encodeURIComponent(cat)}/${encodeURIComponent(file)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (json.success) {
        // Update sidebar title from H1 in content（标题可能带颜色等内联 HTML，剥成纯文本）
        const h1Match = content.match(/^#\s+(.+)/m);
        if (h1Match) {
          const newTitle = stripMdText(h1Match[1]);
          setCategories((prev) =>
            prev.map((c) => {
              if (c.slug !== cat) return c;
              return {
                ...c,
                questions: c.questions.map((q) =>
                  q.filename === file ? { ...q, title: newTitle } : q
                ),
              };
            })
          );
          setTabs((prev) =>
            prev.map((t) => (t.id === `cat:${cat}:${file}` ? { ...t, label: newTitle } : t))
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
        if (activeTabId) closeTab(activeTabId);
        else {
          setSelectedFile(null);
          setView('browse');
        }
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

    // Pick random
    const idx = Math.floor(Math.random() * allQuestions.length);
    const picked = allQuestions[idx];
    const tabId = `random:${picked.category}:${picked.filename}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      addTabToFront(existing);
      activateTab(existing);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/categories/${picked.category}/${picked.filename}`);
      const json = await res.json();
      if (json.success) {
        const label = categories.find((c) => c.slug === picked.category)?.questions.find((q) => q.filename === picked.filename)?.title || picked.filename;
        const tab: DocTab = { id: tabId, kind: 'random', category: picked.category, filename: picked.filename, label };
        setTabContents((prev) => ({ ...prev, [tabId]: json.data }));
        addTabToFront(tab);
        activateTab(tab);
      } else {
        showToast('加载失败', 'error');
      }
    } catch (e) {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openTag = (tagName: string) => {
    saveActiveTabScroll();
    prevStateRef.current = {
      view: (view === 'new' || view === 'new-empty' || view === 'tag') ? 'browse' : view,
      selectedCategory,
      selectedFile,
    };
    setSelectedTag(tagName);
    setView('tag');
  };

  const openProjectDoc = (subdir: string, filename: string) => {
    const tabId = `proj:${subdir}:${filename}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      addTabToFront(existing);
      activateTab(existing);
      return;
    }
    const label = projectSubdirs.find((s) => s.slug === subdir)?.docs.find((d) => d.filename === filename)?.title || filename;
    const tab: DocTab = { id: tabId, kind: 'project', subdir, filename, label };
    addTabToFront(tab);
    activateTab(tab);
  };

  // 文档内链接跳转：总是新开一个标签页（同一文档可并存多个标签，id 带序号防冲突）
  const openDocLinkInNewTab = async (kind: 'category' | 'project', category: string, filename: string) => {
    const seq = ++linkTabSeqRef.current;
    const tabId = `${kind === 'category' ? 'cat' : 'proj'}:${category}:${filename}:${seq}`;
    if (kind === 'category') {
      try {
        const res = await fetch(`/api/categories/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`);
        const json = await res.json();
        if (!json.success) return;
        const label = categories.find((c) => c.slug === category)?.questions.find((q) => q.filename === filename)?.title || filename;
        const tab: DocTab = { id: tabId, kind: 'category', category, filename, label };
        setTabContents((prev) => ({ ...prev, [tabId]: json.data }));
        addTabToFront(tab);
        activateTab(tab);
      } catch {
        showToast('加载题目失败', 'error');
      }
      return;
    }
    const label = projectSubdirs.find((s) => s.slug === category)?.docs.find((d) => d.filename === filename)?.title || filename;
    const tab: DocTab = { id: tabId, kind: 'project', subdir: category, filename, label };
    addTabToFront(tab);
    activateTab(tab);
  };

  const openExternalList = () => {
    deactivateTab();
    setBrowsingExternal(true);
    setSelectedCategory(null);
    setSelectedProjectSubdir(null);
    setSelectedFile(null);
    setView('browse');
  };

  const openExternalDoc = (id: string) => {
    const tabId = `ext:${id}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      addTabToFront(existing);
      activateTab(existing);
      return;
    }
    const docInfo = externalDocs.find((d) => d.id === id);
    const label = docInfo?.title || (docInfo?.path || '').split(/[\\/]/).pop() || '外部文档';
    const tab: DocTab = { id: tabId, kind: 'external', extId: id, label };
    addTabToFront(tab);
    activateTab(tab);
  };

  // 点击 wiki 链接 → 打开目标文档并滚动到锚点（含逐级回退）
  const handleWikiLinkOpen = async (wiki: string, slugHint?: string) => {
    const [docKey, ...anchors] = wiki.split('#').map(s => s.trim()).filter(Boolean);
    if (!docKey) return;

    // 通过搜索接口定位目标文档
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(docKey)}`);
      const json = await res.json();
      if (!json.success) return;
      const docs = json.data as { kind: string; category: string; filename: string }[];
      const byKey = (d: { kind: string; category: string; filename: string }) => d.filename.replace(/\.md$/, '') === docKey;
      const target =
        (slugHint && docs.find(d => byKey(d) && d.category === slugHint)) ||
        docs.find(byKey) ||
        docs[0];
      if (!target) return;
      if (target.kind === 'category') {
        await openDocLinkInNewTab('category', target.category, target.filename);
      } else {
        openDocLinkInNewTab('project', target.category, target.filename);
      }
      setPendingAnchor(anchors.length > 0 ? anchors : null);
    } catch {}
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { wiki?: string; kind?: 'doc' | 'tag' | 'index'; slugHint?: string };
      if (!detail?.wiki) return;

      if (detail.kind === 'tag') {
        deactivateTab();
        openTag(detail.wiki);
        return;
      }
      if (detail.kind === 'index') {
        const slug = detail.wiki;
        const isProject = projectSubdirs.some(s => s.slug === slug);
        deactivateTab();
        setBrowsingExternal(false);
        setSelectedFile(null);
        if (isProject) {
          setSelectedCategory(null);
          setSelectedProjectSubdir(slug);
        } else {
          setSelectedCategory(slug);
          setSelectedProjectSubdir(null);
        }
        setView('browse');
        return;
      }
      handleWikiLinkOpen(detail.wiki, detail.slugHint);
    };
    window.addEventListener('open-wiki-link', handler);
    return () => window.removeEventListener('open-wiki-link', handler);
  }, [view, selectedCategory, selectedFile, categories, projectSubdirs]);

  // 标签视图（TagViewer）返回：恢复进入标签前的浏览/文档视图
  const backFromRandom = () => {
    const prev = prevStateRef.current;
    setSelectedCategory(prev.selectedCategory);
    setSelectedFile(prev.selectedFile);
    setView(prev.view);
    // 从文档内点标签链接进入标签视图时会取消标签激活，返回时恢复
    if ((prev.view === 'edit' || prev.view === 'random') && prev.selectedCategory && prev.selectedFile) {
      const wantKind = prev.view === 'edit' ? 'category' : 'random';
      const tab = tabs.find(
        (t) => t.kind === wantKind && t.category === prev.selectedCategory && t.filename === prev.selectedFile
      );
      if (tab) setActiveTabId(tab.id);
    } else if (prev.view === 'project-doc' && projectSubdir && projectFilename) {
      const tab = tabs.find(
        (t) => t.kind === 'project' && t.subdir === projectSubdir && t.filename === projectFilename
      );
      if (tab) setActiveTabId(tab.id);
    }
  };

  const currentCategoryName = categories.find((c) => c.slug === selectedCategory)?.name || selectedCategory;

  // 全库统计：categories + project（含分组）的全部文档，不含外部文档
  const totalDocs =
    categories.reduce((s, c) => s + c.questionCount, 0) +
    projectSubdirs.reduce((s, d) => s + d.docs.length, 0);
  const totalWords =
    categories.reduce((s, c) => s + c.questions.reduce((w, q) => w + (q.wordCount || 0), 0), 0) +
    projectSubdirs.reduce((s, d) => s + d.docs.reduce((w, doc) => w + (doc.wordCount || 0), 0), 0);

  return (
    <div id="app-root">
      <Sidebar
        categories={categories}
        tags={tags}
        selectedCategory={selectedCategory}
        selectedFile={selectedFile}
        refreshKey={refreshKey}
        onRefresh={async () => { await loadCategories(); await loadTags(); await loadProjectStats(); await loadExternalDocs(); setRefreshKey(k => k + 1); }}
        onSelectCategory={(slug) => {
          deactivateTab();
          setSelectedCategory(slug);
          setSelectedProjectSubdir(null);
          setSelectedFile(null);
          setBrowsingExternal(false);
          setView('browse');
        }}
        onSelectProjectSubdir={(subdir) => {
          deactivateTab();
          setSelectedProjectSubdir(subdir);
          setSelectedCategory(null);
          setSelectedFile(null);
          setBrowsingExternal(false);
          setView('browse');
        }}
        onSelectQuestion={(cat, filename) => openQuestion(cat, filename)}
        onSelectTag={openTag}
        onSelectProgram={openProjectDoc}
        onSelectExternalList={openExternalList}
        onSelectExternalDoc={openExternalDoc}
        onExternalMissing={(path) => showToast('索引失效：文件已移动、重命名或删除。原位置：' + path, 'error')}
        onToast={(msg, type) => showToast(msg, type || 'info')}
        onNewQuestion={openFormTab}
        onGoHome={() => {
          deactivateTab();
          setSelectedCategory(null);
          setSelectedProjectSubdir(null);
          setSelectedFile(null);
          setBrowsingExternal(false);
          setView('browse');
        }}
        onMoveQuestion={handleMoveQuestion}
      />

      <div className="main">
        <TabBar
          tabs={tabs.map((t) => ({ id: t.id, label: t.label }))}
          activeId={activeTabId}
          onSelect={(id) => {
            const tab = tabs.find((t) => t.id === id);
            if (tab) activateTab(tab);
          }}
          onClose={closeTab}
          onCloseAll={closeAllTabs}
        />
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
                : view === 'external-doc'
                ? (externalDocs.find(d => d.id === externalDocId)?.title ||
                   (externalDocs.find(d => d.id === externalDocId)?.path || '').split(/[\\/]/).pop() || '外部文档')
                : view === 'browse' && browsingExternal
                ? '外部文档'
                : view === 'browse' && selectedProjectSubdir
                ? selectedProjectSubdir
                : currentCategoryName || '首页'}
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
                 browsingExternal ? '外部文档 — 文档列表' :
                 '首页 — 全部文档'}
              </span>
            )}
            {view === 'external-doc' && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {externalDocs.find(d => d.id === externalDocId)?.path || ''}
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
            <button className="btn btn-primary" onClick={openFormTab}>
              + 新建题目
            </button>
          </div>
        </header>

        {(view === 'edit' || view === 'random' || view === 'project-doc' || view === 'external-doc') && <EditorToolbar />}

        <div className="content" ref={contentRef}>
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

          {view === 'browse' && browsingExternal && (
            <ExternalBrowseView
              docs={externalDocs}
              onOpenDoc={openExternalDoc}
              onMissing={(path) => showToast('索引失效：文件已移动、重命名或删除。原位置：' + path, 'error')}
            />
          )}

          {view === 'browse' && !selectedCategory && !selectedProjectSubdir && !browsingExternal && (
            <HomeView
              categories={categories}
              projectSubdirs={projectSubdirs}
              externalDocs={externalDocs}
              onSelectQuestion={openQuestion}
              onSelectProjectDoc={openProjectDoc}
              onSelectExternalDoc={openExternalDoc}
              onExternalMissing={(path) => showToast('索引失效：文件已移动、重命名或删除。原位置：' + path, 'error')}
            />
          )}

          {view === 'tag' && selectedTag && (
            <TagViewer
              tagName={selectedTag}
              onBack={backFromRandom}
              onOpenQuestion={(cat, filename) => openQuestion(cat, filename)}
            />
          )}

          {/* 已打开文档的标签面板：全部保持挂载（隐藏切换），保留编辑状态；切换时恢复各自滚动位置 */}
          {tabs.map((tab) => {
            const visible = tab.id === activeTabId && DOC_VIEWS.includes(view as (typeof DOC_VIEWS)[number]);
            return (
              <div key={tab.id} style={{ display: visible ? 'block' : 'none' }}>
                {tab.kind === 'category' && tab.category && tab.filename && tabContents[tab.id] != null && (
                  <DocumentEditor
                    key={tab.id}
                    markdown={tabContents[tab.id]}
                    filename={tab.filename}
                    category={tab.category}
                    onSave={saveEdit}
                    onSaveStatusChange={setEditorSaveStatus}
                    pendingAnchor={visible ? pendingAnchor : null}
                    onAnchorDone={() => setPendingAnchor(null)}
                  />
                )}
                {tab.kind === 'random' && tab.category && tab.filename && tabContents[tab.id] != null && (
                  <RandomQuestion
                    key={tab.id}
                    markdown={tabContents[tab.id]}
                    filename={tab.filename}
                    category={categories.find((c) => c.slug === tab.category)?.name || tab.category}
                    categorySlug={tab.category}
                    onSave={saveEdit}
                    onBack={closeActiveTab}
                    imageBase={`/api/raw/categories/${encodeURIComponent(tab.category)}`}
                    uploadDir={`categories/${tab.category}`}
                  />
                )}
                {tab.kind === 'project' && tab.subdir && tab.filename && (
                  <ProjectDocumentView
                    subdir={tab.subdir}
                    filename={tab.filename}
                    onBack={closeActiveTab}
                    onSaved={() => setRefreshKey(k => k + 1)}
                    onSaveStatusChange={setEditorSaveStatus}
                    pendingAnchor={visible ? pendingAnchor : null}
                    onAnchorDone={() => setPendingAnchor(null)}
                  />
                )}
                {tab.kind === 'external' && tab.extId && (
                  <ExternalDocView
                    id={tab.extId}
                    onBack={closeActiveTab}
                    onSaveStatusChange={setEditorSaveStatus}
                    onSaved={() => loadExternalDocs()}
                  />
                )}
                {tab.kind === 'form' && (
                  <GenerateForm
                    key={tab.id}
                    categories={categories}
                    tags={tags}
                    onGenerated={async (filePath: string) => {
                      const parts = filePath.replace(/\\/g, '/').split('/');
                      const cat = parts[1] || '';
                      const filename = parts[2] || '';
                      showToast('题目生成成功！', 'success');
                      await loadCategories();
                      await loadTags();
                      // 先激活新题标签，再移除表单标签，避免中间切换闪烁
                      await openQuestion(cat, filename);
                      setTabs((prev) => prev.filter((t) => t.id !== tab.id));
                      setTabContents((prev) => {
                        const next = { ...prev };
                        delete next[tab.id];
                        return next;
                      });
                      delete tabScrollsRef.current[tab.id];
                    }}
                    onCancel={() => closeTab(tab.id)}
                    onGeneratingChange={(g) => setGeneratingCount((c) => Math.max(0, c + (g ? 1 : -1)))}
                  />
                )}
              </div>
            );
          })}
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
            {projectStats.groups} 个其他分组
            {' | '}
            {externalDocs.length} 个外部文档
            {externalDocs.some(d => d.missing) ? `（${externalDocs.filter(d => d.missing).length} 失效）` : ''}
          </span>
          <span style={{ marginLeft: 32 }}>
            共 {totalDocs.toLocaleString()} 篇文档 | 共 {totalWords.toLocaleString()} 字
          </span>
          <span>
            {generating ? (
              <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
                <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5, marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
                正在生成题目...
              </span>
            ) : editorSaveStatus || (loading ? '加载中...' : '')}
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
            showToast('空文档创建成功！', 'success');
            await loadCategories();
            await loadTags();
            openQuestion(cat, filename);
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

      {(view === 'edit' || view === 'random' || view === 'project-doc' || view === 'external-doc') && (
        <>
          <AIFloat />
          <LinkInsertFloat />
          <TocFloat />
          <BackToTop />
        </>
      )}
    </div>
  );
}

/** 拖拽移动的乐观列表更新：把 filename 从 fromCat 移到 toCat 的 toIndex 槽位（移除后列表语义） */
function reorderCategories(
  prev: CategoryInfo[],
  fromCat: string,
  filename: string,
  toCat: string,
  toIndex: number,
): CategoryInfo[] {
  const moved = prev.find((c) => c.slug === fromCat)?.questions.find((q) => q.filename === filename);
  if (!moved) return prev;
  return prev.map((c) => {
    if (c.slug === fromCat && c.slug === toCat) {
      const qs = [...c.questions];
      const qi = qs.findIndex((q) => q.filename === filename);
      if (qi < 0) return c;
      const [q] = qs.splice(qi, 1);
      qs.splice(Math.max(0, Math.min(toIndex, qs.length)), 0, q);
      return { ...c, questions: qs };
    }
    if (c.slug === fromCat) {
      const qs = c.questions.filter((q) => q.filename !== filename);
      return { ...c, questions: qs, questionCount: qs.length };
    }
    if (c.slug === toCat) {
      const qs = [...c.questions];
      qs.splice(Math.max(0, Math.min(toIndex, qs.length)), 0, moved);
      return { ...c, questions: qs, questionCount: qs.length };
    }
    return c;
  });
}

function HomeView({
  categories,
  projectSubdirs,
  externalDocs,
  onSelectQuestion,
  onSelectProjectDoc,
  onSelectExternalDoc,
  onExternalMissing,
}: {
  categories: CategoryInfo[];
  projectSubdirs: { slug: string; name: string; isGroup?: boolean; docs: { filename: string; title: string; wordCount?: number }[] }[];
  externalDocs: ExternalDocInfo[];
  onSelectQuestion: (cat: string, filename: string) => void;
  onSelectProjectDoc: (subdir: string, filename: string) => void;
  onSelectExternalDoc: (id: string) => void;
  onExternalMissing: (path: string) => void;
}) {
  const projectNormal = projectSubdirs.filter((s) => !s.isGroup);
  const groups = projectSubdirs.filter((s) => s.isGroup);
  const catDocs = categories.reduce((s, c) => s + c.questions.length, 0);
  const projDocs = projectNormal.reduce((s, d) => s + d.docs.length, 0);
  const groupDocs = groups.reduce((s, d) => s + d.docs.length, 0);

  if (catDocs + projDocs + groupDocs + externalDocs.length === 0) {
    return (
      <div className="empty-state">
        <h3>知识库为空</h3>
        <p>从左侧边栏创建分类、添加外部文档，或点击「新建题目」开始</p>
      </div>
    );
  }

  let docIndex = 0;
  const docRow = (filename: string, title: string, onClick: () => void, wordCount?: number) => {
    docIndex += 1;
    return (
      <div key={filename} className="question-list-item" onClick={onClick} title={title}>
        <span className="doc-index">{docIndex}.</span>
        <span className="title">{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
          {wordCount != null ? wordCount.toLocaleString() + ' 字' : ''}
        </span>
      </div>
    );
  };

  return (
    <div className="home-view">
      <div className="home-stats">
        <span>{categories.length} 个分类 · {catDocs} 道题目</span>
        <span>{projectNormal.length} 个 project · {projDocs} 篇文档</span>
        <span>{groups.length} 个分组 · {groupDocs} 篇文档</span>
        <span>{externalDocs.length} 个外部文档</span>
      </div>

      {categories.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">分类</div>
          {categories.map((cat) => (
            <div key={cat.slug} className="home-block">
              <div className="home-block-title">
                <span className="home-block-name" title={cat.name}>{cat.name}</span>
                <span className="home-block-count">{cat.questions.length}</span>
              </div>
              <div className="card" style={{ padding: 0, margin: 0 }}>
                {cat.questions.map((q) =>
                  docRow(q.filename, q.title, () => onSelectQuestion(cat.slug, q.filename), (q as { wordCount?: number }).wordCount)
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {projectNormal.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">project</div>
          {projectNormal.map((sub) => (
            <div key={sub.slug} className="home-block">
              <div className="home-block-title">
                <span className="home-block-name" title={sub.slug}>{sub.name}</span>
                <span className="home-block-count">{sub.docs.length}</span>
              </div>
              <div className="card" style={{ padding: 0, margin: 0 }}>
                {sub.docs.map((doc) =>
                  docRow(doc.filename, doc.title, () => onSelectProjectDoc(sub.slug, doc.filename), (doc as { wordCount?: number }).wordCount)
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">其他分组</div>
          {groups.map((sub) => (
            <div key={sub.slug} className="home-block">
              <div className="home-block-title">
                <span className="home-block-name" title={sub.slug}>{sub.name}</span>
                <span className="home-block-count">{sub.docs.length}</span>
              </div>
              <div className="card" style={{ padding: 0, margin: 0 }}>
                {sub.docs.map((doc) =>
                  docRow(doc.filename, doc.title, () => onSelectProjectDoc(sub.slug, doc.filename), (doc as { wordCount?: number }).wordCount)
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {externalDocs.length > 0 && (
        <div className="home-section">
          <div className="home-section-title">外部文档</div>
          <div className="card" style={{ padding: 0, margin: 0 }}>
            {externalDocs.map((doc) => {
              docIndex += 1;
              return (
              <div
                key={doc.id}
                className="question-list-item"
                onClick={() => (doc.missing ? onExternalMissing(doc.path) : onSelectExternalDoc(doc.id))}
                title={doc.path}
              >
                <span className="doc-index">{docIndex}.</span>
                <span className="title" style={doc.missing ? { color: '#c92a2a' } : undefined}>
                  {doc.missing ? '⚠ ' : ''}{doc.title}
                </span>
                <span
                  className="external-path"
                  style={{ flex: 1, margin: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {doc.path}
                </span>
                {doc.missing ? (
                  <span style={{ fontSize: 11, color: '#c92a2a', flexShrink: 0 }}>索引失效</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {doc.wordCount.toLocaleString()} 字
                  </span>
                )}
              </div>
              );
            })}
          </div>
        </div>
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
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {(q as { wordCount?: number }).wordCount?.toLocaleString() ?? ''} 字
          </span>
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
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {(doc as { wordCount?: number }).wordCount?.toLocaleString() ?? ''} 字
          </span>
        </div>
      ))}
    </div>
  );
}

function fmtMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ExternalBrowseView({
  docs,
  onOpenDoc,
  onMissing,
}: {
  docs: ExternalDocInfo[];
  onOpenDoc: (id: string) => void;
  onMissing: (path: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>
        外部文档 — {docs.length} 篇（按修改时间倒序）
      </div>
      {docs.length === 0 && (
        <div className="empty-state" style={{ padding: 20 }}>
          <p>暂无外部文档，点击侧边栏「外部文档」旁的 + 从资源管理器选择</p>
        </div>
      )}
      {docs.map((doc) => (
        <div
          key={doc.id}
          className="question-list-item"
          onClick={() => (doc.missing ? onMissing(doc.path) : onOpenDoc(doc.id))}
          title={doc.path}
        >
          <span className="title" style={doc.missing ? { color: '#c92a2a' } : undefined}>
            {doc.missing ? '⚠ ' : ''}{doc.title}
            {doc.customTitle && !doc.missing && (
              <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>原名：{doc.originalTitle}</span>
            )}
          </span>
          <span
            className="external-path"
            style={{ flex: 1, margin: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {doc.path}
          </span>
          {doc.missing ? (
            <span style={{ fontSize: 11, color: '#c92a2a', flexShrink: 0 }}>索引失效</span>
          ) : (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, marginRight: 12 }}>
                {doc.wordCount.toLocaleString()} 字
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
                {doc.mtimeMs != null ? fmtMs(doc.mtimeMs) : ''}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
