'use client';

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
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
import GoToBottom from '@/components/GoToBottom';
import TocFloat from '@/components/TocFloat';
import LinkInsertFloat from '@/components/LinkInsertFloat';
import DocSearchFloat from '@/components/DocSearchFloat';
import ScopeSearchPanel from '@/components/ScopeSearchPanel';
import TagViewer from '@/components/TagViewer';
import TabBar from '@/components/TabBar';
import TabRestoreBar from '@/components/TabRestoreBar';
import InboxView from '@/components/InboxView';
import { CategoryInfo, TagInfo, ExternalDocInfo } from '@/lib/types';
import { stripMdText } from '@/lib/stripText';
import { dueEntries } from '@/lib/fsrsLogic';
import type { FsrsCardData, FsrsStore } from '@/lib/fsrsStore';
import { loadTabSession, saveTabSession, clearTabSession } from '@/lib/tabSession';
import { pushRecent } from '@/lib/recent';

interface DocTab {
  id: string;
  kind: 'category' | 'random' | 'review' | 'project' | 'external' | 'form';
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
  const [view, setView] = useState<'browse' | 'new' | 'edit' | 'random' | 'tag' | 'project-doc' | 'new-empty' | 'external-doc' | 'inbox'>('browse');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [projectSubdir, setProjectSubdir] = useState<string | null>(null);
  const [projectFilename, setProjectFilename] = useState<string | null>(null);
  const [externalDocId, setExternalDocId] = useState<string | null>(null);
  const [browsingExternal, setBrowsingExternal] = useState(false);
  // 当前浏览的外部文档分组（'' = 未分组）；null = 浏览全部外部文档列表
  const [selectedExternalGroup, setSelectedExternalGroup] = useState<string | null>(null);
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
  // 侧边栏折叠状态：挂载时从 localStorage 恢复，之后任何变化都写回（阅读长文档时收起腾出全宽）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem('interviewqa:sidebar-collapsed') === '1');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('interviewqa:sidebar-collapsed', sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed]);
  const [projectSubdirs, setProjectSubdirs] = useState<{ slug: string; name: string; isGroup?: boolean; docs: { filename: string; title: string; wordCount?: number }[] }[]>([]);
  const [projectStats, setProjectStats] = useState<{ subdirs: number; docs: number; groups: number }>({ subdirs: 0, docs: 0, groups: 0 });
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([]);
  // FSRS 间隔重复卡片状态（评分回写后乐观更新 + PUT 持久化）
  const [fsrsStore, setFsrsStore] = useState<FsrsStore>({ version: 1, cards: {} });
  const fsrsStoreRef = useRef<FsrsStore>({ version: 1, cards: {} });
  const applyFsrsStore = (s: FsrsStore) => { fsrsStoreRef.current = s; setFsrsStore(s); };

  // 多标签：已打开文档的工作集（文档内容自动保存到磁盘；标签集本身持久化到 localStorage，重启后可询问恢复）
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const tabScrollsRef = useRef<Record<string, number>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 锚点跳转进行中的标签 id：跳转完成前，标签切换的滚动恢复逻辑应跳过，避免先滚到顶部/已存位置再跳到标题
  const anchorNavTabRef = useRef<string | null>(null);
  // 用 ref 保存最新的 tabs / activeTabId，供 window 事件监听器读取，避免闭包捕获旧状态导致同文档判断失效
  const tabsRef = useRef<DocTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  // handleWikiLinkOpen 引用了 tabs/activeTabId 等状态，而事件监听器只在视图变化时重绑，
  // 通过 ref 始终调用最新版本，避免监听器持有旧闭包
  const wikiLinkHandlerRef = useRef<(wiki: string, slugHint?: string) => void>(() => {});

  // ---- 标签会话持久化（浏览器式「恢复上次关闭的标签页」，存取逻辑见 lib/tabSession）----
  // 等待用户恢复决策的上次会话记录；null 表示无可恢复记录或用户已决策
  const [pendingRestore, setPendingRestore] = useState<{ tabs: DocTab[]; activeTabId: string | null } | null>(null);
  // 恢复决策状态：用户决策前禁止写 localStorage，否则挂载时的空工作集会覆盖上次会话记录
  const sessionDecisionRef = useRef<'pending' | 'ready'>('pending');
  // 恢复动作防重入：内容拉取是异步的，期间提示条已卸载但函数仍可能被重复触发
  const restoringRef = useRef(false);

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

  const loadFsrsStore = async () => {
    try {
      const res = await fetch('/api/fsrs');
      const json = await res.json();
      if (json.success) applyFsrsStore(json.data);
    } catch {}
  };

  useEffect(() => {
    loadCategories();
    loadTags();
    loadProjectStats();
    loadExternalDocs();
    loadFsrsStore();
  }, []);

  // 启动时读取上次标签会话：存在可恢复记录则在顶部栏弹出恢复询问条；否则放行常规持久化。
  // 必须定义在持久化 effect 之前——挂载时它先跑，才能在空工作集触发写入前把决策状态置为 pending
  useEffect(() => {
    const session = loadTabSession();
    if (session) {
      setPendingRestore({ tabs: session.tabs, activeTabId: session.activeTabId });
    } else {
      sessionDecisionRef.current = 'ready';
    }
  }, []);

  // 持久化当前标签工作集：标签集/激活标签任何变化都写入 localStorage。
  // 用户未对恢复询问表态就直接打开了新标签时，视为放弃上次会话：清除询问条并以当前工作集覆盖记录
  useEffect(() => {
    if (sessionDecisionRef.current !== 'ready') {
      if (tabs.length === 0) return;
      sessionDecisionRef.current = 'ready';
      setPendingRestore(null);
    }
    saveTabSession(tabs, activeTabId);
  }, [tabs, activeTabId]);

  // 当前题目 key 集合（`<分类>/<文件名>`），过滤已删题目的幽灵卡片
  const questionKeySet = () => {
    const keys = new Set<string>();
    for (const cat of categories) {
      for (const q of cat.questions) keys.add(`${cat.slug}/${q.filename}`);
    }
    return keys;
  };
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

  const activateTab = (tab: DocTab, pendingAnchorToSet?: string[] | null) => {
    saveActiveTabScroll();
    setActiveTabId(tab.id);
    setSelectedCategory(tab.category ?? null);
    setSelectedFile(tab.filename ?? null);
    setProjectSubdir(tab.subdir ?? null);
    setProjectFilename(tab.kind === 'project' ? (tab.filename ?? null) : null);
    setExternalDocId(tab.extId ?? null);
    // 锚点跳转场景：保留挂起的锚点，供新标签的编辑器加载后滚动定位
    setPendingAnchor(pendingAnchorToSet ?? null);
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

  // ---- 标签会话恢复 ----

  // 不恢复：清除上次会话记录，不再询问（此后按当前工作集正常持久化）
  const dismissRestore = () => {
    setPendingRestore(null);
    sessionDecisionRef.current = 'ready';
    clearTabSession();
  };

  // 恢复上次会话：并行拉取各标签内容重建工作集，激活上次关闭前的活跃标签
  const restoreTabs = async () => {
    const session = pendingRestore;
    if (!session || restoringRef.current) return;
    restoringRef.current = true;
    setPendingRestore(null);
    sessionDecisionRef.current = 'ready';

    // 恢复序号计数器：文档内链接新开标签的 id 带递增序号后缀（如 cat:<分类>:<文件>:<seq>），
    // 计数器不回退才能避免与恢复出的带序号标签 id 冲突
    for (const t of session.tabs) {
      const parts = t.id.split(':');
      if (parts.length < 4) continue;
      const seq = Number(parts[parts.length - 1]);
      if (!Number.isFinite(seq)) continue;
      if (parts[0] === 'form') formSeqRef.current = Math.max(formSeqRef.current, seq);
      else linkTabSeqRef.current = Math.max(linkTabSeqRef.current, seq);
    }

    try {
      // 并行加载内容。分类/随机/复习标签的文档若已删除或改名则丢弃该标签；
      // project / 外部文档由各自视图组件自行加载内容，此处只重建标签
      const results = await Promise.all(
        session.tabs.map(async (tab): Promise<{ tab: DocTab; content?: string } | null> => {
          if (tab.kind === 'category' || tab.kind === 'random' || tab.kind === 'review') {
            try {
              const res = await fetch(
                `/api/categories/${encodeURIComponent(tab.category!)}/${encodeURIComponent(tab.filename!)}`
              );
              const json = await res.json();
              if (json.success) return { tab, content: json.data };
            } catch {
              // 网络异常等按失效处理，下方统一丢弃
            }
            return null;
          }
          return { tab };
        })
      );

      // 等待恢复期间用户已另行打开了标签：视为放弃恢复，保留当前工作集
      if (tabsRef.current.length > 0) return;

      const restored = results.filter((r): r is { tab: DocTab; content?: string } => r !== null);
      if (restored.length === 0) {
        clearTabSession();
        showToast('上次打开的文档均已失效，无可恢复的标签', 'info');
        return;
      }

      const contents: Record<string, string> = {};
      for (const r of restored) {
        if (r.content != null) contents[r.tab.id] = r.content;
      }
      const newTabs = restored.map((r) => r.tab);
      // 优先激活上次关闭前的活跃标签；它已失效则退回第一个
      const active = newTabs.find((t) => t.id === session.activeTabId) ?? newTabs[0];
      setTabs(newTabs);
      setTabContents(contents);
      activateTab(active);
      showToast(`已恢复 ${newTabs.length} 个标签页`, 'success');
    } finally {
      restoringRef.current = false;
    }
  };

  // 切换标签后直接恢复滚动位置（无平滑动画）
  useLayoutEffect(() => {
    if (!activeTabId || !contentRef.current) return;
    if (!DOC_VIEWS.includes(view as (typeof DOC_VIEWS)[number])) return;
    // 锚点跳转进行中：目标标题定位由编辑器负责，此处不要先恢复/重置滚动位置造成跳动
    if (anchorNavTabRef.current === activeTabId) return;
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
        // 记录最近浏览（供侧边栏历史入口一键跳回）
        pushRecent({ kind: 'category', category, filename, title: label });
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
      loadFsrsStore(); // 服务端已改写 fsrs key，静默刷新内存态
      showToast(`已移动到 ${toCat}`, 'success');
    } catch (e: any) {
      await loadCategories();
      showToast('移动失败: ' + (e?.message || '未知错误'), 'error');
    }
  };

  // ---- 拖拽移动 project/分组文档（与分类拖拽使用独立接口） ----
  const handleMoveProjectDoc = async (fromSubdir: string, filename: string, toSubdir: string, toIndex: number) => {
    const source = projectSubdirs.find((item) => item.slug === fromSubdir);
    const originalIndex = source?.docs.findIndex((doc) => doc.filename === filename) ?? -1;
    if (originalIndex < 0) return;
    if (fromSubdir === toSubdir && toIndex === originalIndex) {
      showToast('已在原位，无需移动', 'info');
      return;
    }

    setProjectSubdirs((prev) => reorderProjectSubdirs(prev, fromSubdir, filename, toSubdir, toIndex));
    try {
      const res = await fetch('/api/project/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromSubdir, filename, toSubdir, toIndex }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '移动失败');
      if (!json.noop) remapProjectTabsAfterMove(json);
      await loadProjectStats();
      setRefreshKey((key) => key + 1);
      loadFsrsStore();
      if (!json.noop) showToast(`已移动到 ${toSubdir}`, 'success');
    } catch (error: any) {
      await loadProjectStats();
      setRefreshKey((key) => key + 1);
      showToast('移动失败: ' + (error?.message || '未知错误'), 'error');
    }
  };

  // 移动成功后同步 project 标签页 id 与当前打开文档路径。
  const remapProjectTabsAfterMove = (json: {
    moved: { from: { category: string; filename: string }; to: { category: string; filename: string } };
    sourceRenames: Record<string, string>;
    targetRenames: Record<string, string>;
  }) => {
    const { moved, sourceRenames, targetRenames } = json;
    const mapping = new Map<string, { subdir: string; filename: string }>();
    const keyOf = (subdir: string, file: string) => `${subdir}\u0000${file}`;
    for (const [oldFilename, newFilename] of Object.entries(sourceRenames)) {
      mapping.set(keyOf(moved.from.category, oldFilename), { subdir: moved.from.category, filename: newFilename });
    }
    for (const [oldFilename, newFilename] of Object.entries(targetRenames)) {
      mapping.set(keyOf(moved.to.category, oldFilename), { subdir: moved.to.category, filename: newFilename });
    }
    mapping.set(
      keyOf(moved.from.category, moved.from.filename),
      { subdir: moved.to.category, filename: moved.to.filename },
    );

    const touched: { oldId: string; newId: string; subdir: string; filename: string }[] = [];
    const nextTabs = tabs.map((tab) => {
      if (tab.kind !== 'project' || !tab.subdir || !tab.filename) return tab;
      const destination = mapping.get(keyOf(tab.subdir, tab.filename));
      if (!destination) return tab;
      const parts = tab.id.split(':');
      const suffix = parts.slice(3).join(':');
      const newId = `proj:${destination.subdir}:${destination.filename}${suffix ? ':' + suffix : ''}`;
      touched.push({ oldId: tab.id, newId, ...destination });
      return { ...tab, id: newId, subdir: destination.subdir, filename: destination.filename };
    });
    if (touched.length === 0) return;

    setTabs(nextTabs);
    for (const item of touched) {
      const scrollTop = tabScrollsRef.current[item.oldId];
      if (scrollTop != null) {
        tabScrollsRef.current[item.newId] = scrollTop;
        delete tabScrollsRef.current[item.oldId];
      }
    }
    if (activeTabId) {
      const active = touched.find((item) => item.oldId === activeTabId);
      if (active) {
        setActiveTabId(active.newId);
        setProjectSubdir(active.subdir);
        setSelectedProjectSubdir(active.subdir);
        setProjectFilename(active.filename);
      }
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
        loadFsrsStore(); // 服务端已删除/改移 fsrs key，静默刷新内存态
      } else {
        showToast('删除失败: ' + json.error, 'error');
      }
    } catch (e: any) {
      showToast('删除失败: ' + e.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // 删除 project/groups 子目录下的文档（后端与分类删除共用同一套序号重排联动逻辑）
  const deleteProjectDoc = async () => {
    if (!projectSubdir || !projectFilename) return;
    if (deleting) return;
    if (!confirm(`确认删除 "${projectFilename}"？此操作不可撤销。`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(projectSubdir)}/${encodeURIComponent(projectFilename)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        if (activeTabId) closeTab(activeTabId);
        else {
          setProjectFilename(null);
          setView('browse');
        }
        showToast('删除成功！', 'success');
        await loadProjectStats(); // 刷新侧边栏 project/分组文档列表
        setRefreshKey(k => k + 1);
        loadFsrsStore(); // 服务端已删除/改移 fsrs key，静默刷新内存态
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
        // 随机打开的题目同样计入最近浏览
        pushRecent({ kind: 'category', category: picked.category, filename: picked.filename, title: label });
      } else {
        showToast('加载失败', 'error');
      }
    } catch (e) {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ---- FSRS 间隔重复复习 ----

  const openReviewQuestion = async (category: string, filename: string) => {
    const tabId = `review:${category}:${filename}`;
    const existing = tabs.find((t) => t.id === tabId);
    if (existing) {
      addTabToFront(existing);
      activateTab(existing);
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`/api/categories/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`);
      const json = await res.json();
      if (json.success) {
        const label = categories.find((c) => c.slug === category)?.questions.find((q) => q.filename === filename)?.title || filename;
        const tab: DocTab = { id: tabId, kind: 'review', category, filename, label };
        setTabContents((prev) => ({ ...prev, [tabId]: json.data }));
        addTabToFront(tab);
        activateTab(tab);
      } else {
        showToast('加载失败', 'error');
      }
    } catch {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 评分后自动进入下一道到期题；队列清空则提示完成并关闭当前标签
  const openNextReview = async () => {
    const due = dueEntries(fsrsStoreRef.current.cards, questionKeySet());
    if (due.length === 0) {
      showToast('今日复习完成！', 'success');
      closeActiveTab();
      return;
    }
    const key = due[0].key;
    const slash = key.indexOf('/');
    await openReviewQuestion(key.slice(0, slash), key.slice(slash + 1));
  };

  // 评分回写：乐观更新内存态 → PUT 持久化 → 提示下次复习时间
  const handleRateQuestion = (category: string, filename: string, rating: number, cardData: FsrsCardData) => {
    const key = `${category}/${filename}`;
    const prev = fsrsStoreRef.current;
    const next: FsrsStore = { ...prev, cards: { ...prev.cards, [key]: cardData } };
    applyFsrsStore(next);
    fetch('/api/fsrs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
    const dueDate = new Date(cardData.due);
    const sameDay = !isNaN(dueDate.getTime()) && dueDate.toDateString() === new Date().toDateString();
    showToast(`已评分，${sameDay ? '今天稍后' : `${dueDate.getMonth() + 1}月${dueDate.getDate()}日`}复习`, 'success');
  };

  const openTag = (tagName: string) => {
    saveActiveTabScroll();
    prevStateRef.current = {
      view: (view === 'new' || view === 'new-empty' || view === 'tag' || view === 'inbox') ? 'browse' : view,
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
    // project 文档同样计入最近浏览
    pushRecent({ kind: 'project', category: subdir, filename, title: label });
  };

  // 文档内链接跳转：总是新开一个标签页（同一文档可并存多个标签，id 带序号防冲突）
  const openDocLinkInNewTab = async (kind: 'category' | 'project', category: string, filename: string, anchors?: string[] | null) => {
    const seq = ++linkTabSeqRef.current;
    const tabId = `${kind === 'category' ? 'cat' : 'proj'}:${category}:${filename}:${seq}`;
    // 锚点随标签激活一并挂起：避免切换标签的布局副作用先把容器滚到顶部再跳到标题，造成视觉跳动
    const pendingAnchorToSet = anchors && anchors.length > 0 ? anchors : null;
    if (pendingAnchorToSet) anchorNavTabRef.current = tabId;
    if (kind === 'category') {
      try {
        const res = await fetch(`/api/categories/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`);
        const json = await res.json();
        if (!json.success) return;
        const label = categories.find((c) => c.slug === category)?.questions.find((q) => q.filename === filename)?.title || filename;
        const tab: DocTab = { id: tabId, kind: 'category', category, filename, label };
        setTabContents((prev) => ({ ...prev, [tabId]: json.data }));
        addTabToFront(tab);
        activateTab(tab, pendingAnchorToSet);
      } catch {
        showToast('加载题目失败', 'error');
      }
      return;
    }
    const label = projectSubdirs.find((s) => s.slug === category)?.docs.find((d) => d.filename === filename)?.title || filename;
    const tab: DocTab = { id: tabId, kind: 'project', subdir: category, filename, label };
    addTabToFront(tab);
    activateTab(tab, pendingAnchorToSet);
  };

  const openExternalList = () => {
    deactivateTab();
    setBrowsingExternal(true);
    // 回到全部外部文档列表：清除分组选中
    setSelectedExternalGroup(null);
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
    // 外部文档同样计入最近浏览（filename 存外部文档 id）
    pushRecent({ kind: 'external', category: '', filename: id, title: label });
  };

  // 打开待入库题单（收集面试题的编辑页）
  const openInbox = () => {
    deactivateTab();
    setSelectedCategory(null);
    setSelectedProjectSubdir(null);
    setSelectedFile(null);
    setBrowsingExternal(false);
    setView('inbox');
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
      // 同一文档内的锚点链接：直接触发当前编辑器滚动到标题，不新开标签。
      // 必须从 ref 读取最新的标签/激活状态，事件监听器闭包会捕获旧值导致判断失效。
      const curTabs = tabsRef.current;
      const curActiveId = activeTabIdRef.current;
      const activeTab = curTabs.find((t) => t.id === curActiveId);
      const isSameDoc = !!activeTab && (
        (target.kind === 'category' && activeTab.kind === 'category' && activeTab.category === target.category && activeTab.filename === target.filename) ||
        (target.kind === 'project' && activeTab.kind === 'project' && activeTab.subdir === target.category && activeTab.filename === target.filename)
      );
      if (isSameDoc && anchors.length > 0) {
        console.log('[anchor-nav] 页面层判定为同文档，复用当前标签滚动', { docKey, anchors });
        // 标记本次锚点跳转，防止标签滚动恢复逻辑干扰
        if (curActiveId) anchorNavTabRef.current = curActiveId;
        setPendingAnchor(anchors);
        return;
      }
      console.log('[anchor-nav] 页面层判定为跨文档，新开标签', { docKey, anchors, isSameDoc });
      if (target.kind === 'category') {
        await openDocLinkInNewTab('category', target.category, target.filename, anchors);
      } else {
        openDocLinkInNewTab('project', target.category, target.filename, anchors);
      }
    } catch {}
  };
  // 始终指向最新实现，供只绑定一次的 window 事件监听器调用
  wikiLinkHandlerRef.current = handleWikiLinkOpen;

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
      wikiLinkHandlerRef.current(detail.wiki, detail.slugHint);
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

  // 锚点跳转完成：清空挂起锚点与跳转标记，之后标签切换恢复滚动位置的逻辑重新生效
  const handleAnchorDone = useCallback(() => {
    anchorNavTabRef.current = null;
    setPendingAnchor(null);
  }, []);

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
          setSelectedExternalGroup(null);
          setView('browse');
        }}
        onSelectProjectSubdir={(subdir) => {
          deactivateTab();
          setSelectedProjectSubdir(subdir);
          setSelectedCategory(null);
          setSelectedFile(null);
          setBrowsingExternal(false);
          setSelectedExternalGroup(null);
          setView('browse');
        }}
        onSelectQuestion={(cat, filename) => openQuestion(cat, filename)}
        onSelectTag={openTag}
        onSelectProgram={openProjectDoc}
        onSelectExternalList={openExternalList}
        onSelectExternalGroup={(group) => {
          // 与分类/子目录一致：点击外部文档分组打开该分组的文档列表视图
          deactivateTab();
          setBrowsingExternal(true);
          setSelectedExternalGroup(group);
          setSelectedCategory(null);
          setSelectedProjectSubdir(null);
          setSelectedFile(null);
          setView('browse');
        }}
        onSelectExternalDoc={openExternalDoc}
        onExternalMissing={(path) => showToast('索引失效：文件已移动、重命名或删除。原位置：' + path, 'error')}
        onToast={(msg, type) => showToast(msg, type || 'info')}
        onNewQuestion={openFormTab}
        onOpenInbox={openInbox}
        inboxActive={view === 'inbox'}
        onGoHome={() => {
          deactivateTab();
          setSelectedCategory(null);
          setSelectedProjectSubdir(null);
          setSelectedFile(null);
          setBrowsingExternal(false);
          setSelectedExternalGroup(null);
          setView('browse');
        }}
        onMoveQuestion={handleMoveQuestion}
        onMoveProjectDoc={handleMoveProjectDoc}
        onOpenLogs={() => setShowLogs(true)}
        onOpenRandom={openRandom}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="main">
        {pendingRestore && (
          <TabRestoreBar
            count={pendingRestore.tabs.length}
            onRestore={restoreTabs}
            onDismiss={dismissRestore}
          />
        )}
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
                : view === 'inbox'
                ? '待入库题单'
                : view === 'browse' && browsingExternal
                ? (selectedExternalGroup != null ? (selectedExternalGroup || '未分组') : '外部文档')
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
                 browsingExternal ? `${selectedExternalGroup != null ? (selectedExternalGroup || '未分组') : '外部文档'} — 文档列表` :
                 '首页 — 全部文档'}
              </span>
            )}
            {view === 'external-doc' && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {externalDocs.find(d => d.id === externalDocId)?.path || ''}
              </span>
            )}
            {view === 'inbox' && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                面试题收集 · 持久化为 Markdown · 勾选标记已入库
              </span>
            )}
          </div>
          <div className="header-actions">
            {view === 'edit' && (
              <button className="btn btn-danger" onClick={deleteQuestion}>
                删除此题
              </button>
            )}
            {view === 'project-doc' && projectSubdir && projectFilename && (
              <button className="btn btn-danger" onClick={deleteProjectDoc}>
                删除文档
              </button>
            )}
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
              docs={selectedExternalGroup != null
                ? externalDocs.filter((d) => (d.group || '') === selectedExternalGroup)
                : externalDocs}
              group={selectedExternalGroup}
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

          {view === 'inbox' && (
            <InboxView onToast={(msg, type) => showToast(msg, type || 'info')} />
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
                    onAnchorDone={handleAnchorDone}
                  />
                )}
                {(tab.kind === 'random' || tab.kind === 'review') && tab.category && tab.filename && tabContents[tab.id] != null && (
                  <RandomQuestion
                    key={tab.id}
                    markdown={tabContents[tab.id]}
                    filename={tab.filename}
                    category={categories.find((c) => c.slug === tab.category)?.name || tab.category}
                    categorySlug={tab.category}
                    onSave={saveEdit}
                    onBack={closeActiveTab}
                    mode={tab.kind === 'review' ? 'review' : 'random'}
                    fsrsCard={fsrsStore.cards[`${tab.category}/${tab.filename}`]}
                    onRate={(rating, cardData) => handleRateQuestion(tab.category!, tab.filename!, rating, cardData)}
                    onNext={tab.kind === 'review' ? () => openNextReview() : undefined}
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
                  // 保存后除更新页面级外部文档列表（标签页标题）外，递增 refreshKey 让 Sidebar 立即重拉 /api/external，与 project 文档行为对齐
                  <ExternalDocView
                    id={tab.extId}
                    onBack={closeActiveTab}
                    onSaveStatusChange={setEditorSaveStatus}
                    onSaved={() => { loadExternalDocs(); setRefreshKey(k => k + 1); }}
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
          <DocSearchFloat />
          <GoToBottom />
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

/** project/分组文档拖拽时的乐观列表更新。 */
function reorderProjectSubdirs(
  prev: { slug: string; name: string; isGroup?: boolean; docs: { filename: string; title: string; wordCount?: number }[] }[],
  fromSubdir: string,
  filename: string,
  toSubdir: string,
  toIndex: number,
) {
  const moved = prev.find((item) => item.slug === fromSubdir)?.docs.find((doc) => doc.filename === filename);
  if (!moved) return prev;
  return prev.map((item) => {
    if (item.slug === fromSubdir && item.slug === toSubdir) {
      const docs = [...item.docs];
      const index = docs.findIndex((doc) => doc.filename === filename);
      if (index < 0) return item;
      const [doc] = docs.splice(index, 1);
      docs.splice(Math.max(0, Math.min(toIndex, docs.length)), 0, doc);
      return { ...item, docs };
    }
    if (item.slug === fromSubdir) return { ...item, docs: item.docs.filter((doc) => doc.filename !== filename) };
    if (item.slug === toSubdir) {
      const docs = [...item.docs];
      docs.splice(Math.max(0, Math.min(toIndex, docs.length)), 0, moved);
      return { ...item, docs };
    }
    return item;
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
                <span className="sidebar-cat-dot" />
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
                <span className="sidebar-cat-dot" />
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
                <span className="sidebar-cat-dot" />
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
  // 检索模式激活（有关键词）时隐藏完整列表，只显示命中结果
  const [searchActive, setSearchActive] = useState(false);

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
      {/* 分类内关键字检索：切换分类时重置检索状态 */}
      <ScopeSearchPanel
        key={selectedCategory}
        scope="category"
        slug={selectedCategory}
        onOpen={(hit) => hit.filename && onSelectQuestion(selectedCategory, hit.filename)}
        onActiveChange={setSearchActive}
      />
      {!searchActive && category.questions.map((q) => (
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
  // 检索模式激活（有关键词）时隐藏完整列表，只显示命中结果
  const [searchActive, setSearchActive] = useState(false);
  if (!subdir) return null;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>
        {subdir.name} — {subdir.docs.length} 篇文档
      </div>
      {/* 分组/子目录内关键字检索：切换目录时重置检索状态 */}
      <ScopeSearchPanel
        key={subdir.slug}
        scope="project"
        slug={subdir.slug}
        onOpen={(hit) => hit.filename && onSelectDoc(subdir.slug, hit.filename)}
        onActiveChange={setSearchActive}
      />
      {subdir.docs.length === 0 && !searchActive && (
        <div className="empty-state" style={{ padding: 20 }}>
          <p>暂无文档</p>
        </div>
      )}
      {!searchActive && subdir.docs.map((doc) => (
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
  group,
  onOpenDoc,
  onMissing,
}: {
  docs: ExternalDocInfo[];
  /** 当前浏览的外部文档分组（'' = 未分组）；null = 浏览全部外部文档 */
  group?: string | null;
  onOpenDoc: (id: string) => void;
  onMissing: (path: string) => void;
}) {
  // 检索模式激活（有关键词）时隐藏完整列表，只显示命中结果
  const [searchActive, setSearchActive] = useState(false);
  const inGroup = group != null;
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 14 }}>
        {inGroup ? `${group || '未分组'} — ${docs.length} 篇` : `外部文档 — ${docs.length} 篇（按修改时间倒序）`}
      </div>
      {/* 分组内关键字检索：切换分组时重置检索状态（仅分组视图提供，与分类/子目录列表一致） */}
      {inGroup && (
        <ScopeSearchPanel
          key={group}
          scope="external"
          slug={group}
          onOpen={(hit) => hit.extId && onOpenDoc(hit.extId)}
          onActiveChange={setSearchActive}
        />
      )}
      {docs.length === 0 && !searchActive && (
        <div className="empty-state" style={{ padding: 20 }}>
          <p>{inGroup ? '该分组下暂无文档' : '暂无外部文档，点击侧边栏「外部文档」旁的 + 从资源管理器选择'}</p>
        </div>
      )}
      {!searchActive && docs.map((doc) => (
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
