'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CategoryInfo, TagInfo, ProjectSubdir, ExternalDocInfo } from '@/lib/types';
import { useSidebarDrag } from './useSidebarDrag';
import GlobalSearchModal from './GlobalSearchModal';
import { getRecent, type RecentEntry } from '@/lib/recent';

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
  // 点击外部文档分组：打开该分组的文档列表视图（空串 = 未分组）
  onSelectExternalGroup?: (group: string) => void;
  onExternalMissing?: (path: string) => void;
  onNewQuestion: () => void;
  onRefresh: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onGoHome?: () => void;
  // 顶部按钮组：查看操作日志
  onOpenLogs?: () => void;
  // 顶部按钮组：随机抽取一道题目
  onOpenRandom?: () => void;
  // 侧边栏折叠开关（状态由 page.tsx 持有并持久化到 localStorage）
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  // 待入库题单入口（分类上方）
  onOpenInbox?: () => void;
  inboxActive?: boolean;
  refreshKey?: number;
  onMoveQuestion: (fromCat: string, filename: string, toCat: string, toIndex: number) => void;
  onMoveProjectDoc: (fromSubdir: string, filename: string, toSubdir: string, toIndex: number) => void;
}

interface CreateForm {
  type: 'category' | 'project-subdir' | 'group' | 'category-doc' | 'project-doc';
  parent?: string; // category slug or project subdir slug
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '-').trim();
}

// 相对时间格式化：用于最近浏览列表（刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / MM-DD HH:mm）
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (diff < 172800_000) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  onSelectExternalGroup,
  onExternalMissing,
  onNewQuestion,
  onRefresh,
  onToast,
  onGoHome,
  onOpenLogs,
  onOpenRandom,
  collapsed = false,
  onToggleCollapse,
  onOpenInbox,
  inboxActive,
  refreshKey = 0,
  onMoveQuestion,
  onMoveProjectDoc,
}: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedProjectSubdirs, setExpandedProjectSubdirs] = useState<Set<string>>(new Set());
  // 栏目整体折叠状态：categories=分类栏目，project=project 栏目，tags=标签栏目
  const [collapsedSections, setCollapsedSections] = useState<Set<'categories' | 'project' | 'tags'>>(new Set());
  const [projectSubdirs, setProjectSubdirs] = useState<ProjectSubdir[]>([]);
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>([]);
  // 待入库题单的未处理题数（入口徽标）
  const [inboxPending, setInboxPending] = useState(0);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [addExternalOpen, setAddExternalOpen] = useState(false);
  // 「新增文档」入口所在的目标分组（'' = 未分组），从分组内的新增文档行带入
  const [addExternalGroup, setAddExternalGroup] = useState('');
  const [externalPathsText, setExternalPathsText] = useState('');
  const [addingExternal, setAddingExternal] = useState(false);
  const [picking, setPicking] = useState<'file' | 'folder' | null>(null);
  const [externalError, setExternalError] = useState('');
  // 外部文档分组：分组名列表（注册顺序）、已折叠的分组（默认全部展开）
  const [externalGroups, setExternalGroups] = useState<string[]>([]);
  const [collapsedExtGroups, setCollapsedExtGroups] = useState<Set<string>>(new Set());
  // 外部文档分组新建/改名弹窗状态
  const [extGroupModal, setExtGroupModal] = useState<{ mode: 'create' } | { mode: 'rename'; oldName: string } | null>(null);
  const [extGroupName, setExtGroupName] = useState('');
  const [extGroupBusy, setExtGroupBusy] = useState(false);
  const [extGroupError, setExtGroupError] = useState('');
  // 全库关键字检索弹窗开关
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // 最近浏览下拉：打开时从 localStorage 读取最近 10 条记录（覆盖分类题目 / project 文档 / 外部文档），点击条目一键跳回
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentList, setRecentList] = useState<RecentEntry[]>([]);
  const recentMenuRef = useRef<HTMLDivElement>(null);

  // 拉取待入库题单的未处理题数（用于入口徽标）
  const loadInboxPending = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox');
      const json = await res.json();
      if (json.success) setInboxPending(json.data?.unchecked ?? 0);
    } catch {}
  }, []);

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
        if (json.success) {
          setExternalDocs(json.data || []);
          setExternalGroups(json.groups || []);
        }
      } catch {}
    })();
    loadInboxPending();
  }, [refreshKey, loadInboxPending]);

  // 题单内容变化（加入新题 / 勾选入库）时刷新待处理徽标
  useEffect(() => {
    window.addEventListener('inbox-changed', loadInboxPending);
    return () => window.removeEventListener('inbox-changed', loadInboxPending);
  }, [loadInboxPending]);

  // 最近浏览下拉：点击菜单外部时自动关闭
  useEffect(() => {
    if (!recentOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !recentMenuRef.current?.contains(e.target)) {
        setRecentOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [recentOpen]);

  // 打开/关闭最近浏览下拉；每次打开都重新读取 localStorage（题目可能刚被打开过）
  const toggleRecent = () => {
    if (recentOpen) {
      setRecentOpen(false);
      return;
    }
    setRecentList(getRecent());
    setRecentOpen(true);
  };

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

  // 折叠/展开整个栏目（分类、project、标签）
  const toggleSection = (section: 'categories' | 'project' | 'tags') => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
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

  // ---- 拖拽移动（project/分组文档 → project/分组目录） ----
  const projectDrag = useSidebarDrag({
    scope: 'project',
    onMoveQuestion: (fromSubdir, filename, toSubdir, toIndex) => {
      setProjectSubdirs((prev) => reorderProjectSubdirs(prev, fromSubdir, filename, toSubdir, toIndex));
      onMoveProjectDoc(fromSubdir, filename, toSubdir, toIndex);
    },
    onExpandCategory: (slug) => {
      setExpandedProjectSubdirs((prev) => {
        if (prev.has(slug)) return prev;
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
    },
  });

  // ---- 拖拽移动（外部文档 → 分组内排序/跨分组移动，与分类/project 拖拽互不互通） ----
  const externalDrag = useSidebarDrag({
    scope: 'external',
    onMoveQuestion: (fromGroup, docId, toGroup, toIndex) => {
      // 乐观更新本地顺序（docs 数组顺序即分组内显示顺序）
      setExternalDocs((prev) => reorderExternalDocs(prev, docId, toGroup, toIndex));
      // 落入的分组若是折叠状态则自动展开，让移动结果立即可见
      setCollapsedExtGroups((prev) => {
        if (!prev.has(toGroup)) return prev;
        const next = new Set(prev);
        next.delete(toGroup);
        return next;
      });
      (async () => {
        try {
          const res = await fetch('/api/external/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: docId, group: toGroup, toIndex }),
          });
          const json = await res.json().catch(() => ({ success: false }));
          if (!json.success) throw new Error(json.error || '移动失败');
          onRefresh();
        } catch (e: any) {
          onToast?.('移动失败: ' + (e?.message || '未知错误'), 'error');
          onRefresh();
        }
      })();
    },
    onExpandCategory: (groupName) => {
      setCollapsedExtGroups((prev) => {
        if (!prev.has(groupName)) return prev;
        const next = new Set(prev);
        next.delete(groupName);
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

  // project/分组拖放后的 FLIP 动画，与分类拖拽使用独立的元素集合。
  useLayoutEffect(() => {
    const pending = projectDrag.flipBeforeRef.current;
    if (!pending || pending.before.size === 0) return;
    projectDrag.flipBeforeRef.current = null;

    const rows = document.querySelectorAll<HTMLElement>('[data-sidebar-project-draggable]');
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
    const inserted = pending.insertKey
      ? Array.from(rows).find((el) => `${el.dataset.catSlug}:${el.dataset.filename}` === pending.insertKey)
      : undefined;
    if (inserted && !shifted.includes(inserted)) {
      inserted.style.transition = 'none';
      inserted.style.opacity = '0';
      inserted.style.transform = 'translateY(-8px)';
      shifted.push(inserted);
    }

    void document.body.offsetHeight;
    for (const el of shifted) {
      el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      el.style.transform = '';
      el.style.opacity = '';
    }
    const timer = window.setTimeout(() => {
      for (const el of shifted) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [projectSubdirs, projectDrag.flipBeforeRef]);

  // 外部文档拖放后的 FLIP 动画，与分类/project 拖拽使用独立的元素集合。
  useLayoutEffect(() => {
    const pending = externalDrag.flipBeforeRef.current;
    if (!pending || pending.before.size === 0) return;
    externalDrag.flipBeforeRef.current = null;

    const rows = document.querySelectorAll<HTMLElement>('[data-sidebar-external-draggable]');
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
    const inserted = pending.insertKey
      ? Array.from(rows).find((el) => `${el.dataset.catSlug}:${el.dataset.filename}` === pending.insertKey)
      : undefined;
    if (inserted && !shifted.includes(inserted)) {
      inserted.style.transition = 'none';
      inserted.style.opacity = '0';
      inserted.style.transform = 'translateY(-8px)';
      shifted.push(inserted);
    }

    void document.body.offsetHeight;
    for (const el of shifted) {
      el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      el.style.transform = '';
      el.style.opacity = '';
    }
    const timer = window.setTimeout(() => {
      for (const el of shifted) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [externalDocs, externalDrag.flipBeforeRef]);

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
        // 从分组内「新增文档」入口添加时，新条目直接加入目标分组
        body: JSON.stringify({ paths, group: addExternalGroup }),
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

  // 折叠/展开外部文档分组（默认展开，这里记录的是已折叠的分组名）
  const toggleExtGroup = (groupName: string) => {
    setCollapsedExtGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  // 提交外部文档分组的新建/改名
  const submitExtGroup = async () => {
    if (!extGroupModal || !extGroupName.trim()) return;
    setExtGroupBusy(true);
    setExtGroupError('');
    try {
      const isCreate = extGroupModal.mode === 'create';
      const res = await fetch('/api/external/groups', {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCreate
          ? { name: extGroupName }
          : { oldName: extGroupModal.oldName, newName: extGroupName }),
      });
      const json = await res.json().catch(() => ({ success: false, error: '保存失败' }));
      if (json.success) {
        onToast?.(isCreate ? '分组已创建' : '分组已重命名', 'success');
        setExtGroupModal(null);
        onRefresh();
      } else {
        setExtGroupError(json.error || '保存失败');
      }
    } catch {
      setExtGroupError('网络错误，请重试');
    }
    setExtGroupBusy(false);
  };

  // 删除外部文档分组（组内文档回到未分组，索引与文件均不动）
  const deleteExtGroup = async (name: string) => {
    if (!confirm(`删除分组「${name}」？组内文档将回到未分组，索引与文件均不受影响。`)) return;
    try {
      const res = await fetch(`/api/external/groups?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({ success: false }));
      if (json.success) {
        onToast?.('分组已删除，文档已回到未分组', 'success');
        onRefresh();
      } else {
        onToast?.(json.error || '删除失败', 'error');
      }
    } catch {
      onToast?.('网络错误，请重试', 'error');
    }
  };

  // 渲染单个外部文档条目（可拖拽：组内排序 / 跨分组移动）
  const renderExternalDocRow = (doc: ExternalDocInfo, groupName: string) => (
    <div
      key={doc.id}
      data-sidebar-external-draggable=""
      data-cat-slug={groupName}
      data-filename={doc.id}
      data-title={doc.title}
    >
      <div
        className={`sidebar-item sidebar-sub ${doc.missing ? 'external-missing' : ''} ${externalDrag.state.item?.filename === doc.id && externalDrag.state.item?.category === groupName ? 'drag-source' : ''}`}
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
          onClick={(e) => { e.stopPropagation(); removeExternal(doc.id); }}
          title="从索引移除（不删除原文件）"
        >
          ×
        </span>
      </div>
      {doc.customTitle && !doc.missing && (
        <div className="external-path" style={{ color: '#8c7e9d', paddingLeft: 24 }}>原文件名标题：{doc.originalTitle}</div>
      )}
      {doc.missing && (
        <div className="external-path" style={{ paddingLeft: 24 }}>{doc.path}</div>
      )}
    </div>
  );

  // 渲染一个外部文档分组区块（groupName 为空 = 未分组，始终排在最后）
  const renderExtGroupSection = (groupName: string) => {
    const isUngrouped = groupName === '';
    const docs = externalDocs.filter((d) => (d.group || '') === groupName);
    const expanded = !collapsedExtGroups.has(groupName);
    return (
      <div
        key={isUngrouped ? '__ext_ungrouped__' : groupName}
        data-sidebar-external-dir={groupName}
        className={`sidebar-project-dir ${externalDrag.state.drop?.category === groupName ? 'drag-target-cat' : ''}`}
        onPointerDown={externalDrag.onPointerDown}
      >
        <button
          className="sidebar-item"
          onClick={() => {
            // 与分类点击行为一致：打开该分组的文档列表视图，同时切换折叠
            onSelectExternalGroup?.(groupName);
            toggleExtGroup(groupName);
          }}
          title={isUngrouped ? '未分组的外部文档；拖拽文档到此可移出分组' : `分组「${groupName}」；拖拽文档到此移入，组内可拖拽排序`}
        >
          <span className="sidebar-cat-dot" />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isUngrouped ? '未分组' : groupName}
          </span>
          <span className="badge">{docs.length}</span>
          {!isUngrouped && (
            <>
              <span
                className="external-remove"
                onClick={(e) => { e.stopPropagation(); setExtGroupName(groupName); setExtGroupError(''); setExtGroupModal({ mode: 'rename', oldName: groupName }); }}
                title="重命名分组"
              >
                ✎
              </span>
              <span
                className="external-remove"
                onClick={(e) => { e.stopPropagation(); deleteExtGroup(groupName); }}
                title="删除分组（组内文档回到未分组）"
              >
                ×
              </span>
            </>
          )}
        </button>
        {expanded && (
          <div>
            {docs.length === 0 && (
              <div className="sidebar-item sidebar-sub" style={{ color: '#999', cursor: 'default' }}>
                {isUngrouped ? '暂无未分组文档' : '（空）拖拽文档到这里'}
              </div>
            )}
            {docs.map((doc) => renderExternalDocRow(doc, groupName))}
            {/* 与分类「新建题目…」、project「新建文档…」一致的组内新增入口 */}
            <button
              className="sidebar-item sidebar-sub sidebar-new-doc"
              onClick={() => { setExternalError(''); setAddExternalGroup(groupName); setAddExternalOpen(true); }}
              title={isUngrouped ? '索引本机外部 md 文档（加入未分组）' : `索引本机外部 md 文档，加入分组「${groupName}」`}
            >
              <span className="sidebar-question-index">+</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#999' }}>
                新增文档...
              </span>
            </button>
          </div>
        )}
        {externalDrag.state.drop?.category === groupName && (
          <div className="sidebar-drop-indicator" style={{ top: externalDrag.state.drop.indicatorTop }} />
        )}
      </div>
    );
  };

  const needsSlug = createForm?.type === 'category' || createForm?.type === 'project-subdir' || createForm?.type === 'group';

  return (
    <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        {/* 顶部按钮组：返回首页 + 全库检索 + 操作日志 + 随机一题 + 最近浏览（折叠时竖排成一列） */}
        <div ref={recentMenuRef} style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', gap: 4, flexShrink: 0, position: 'relative' }}>
          <button className="sidebar-home-btn" onClick={onGoHome} title="返回首页" aria-label="返回首页">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
              <path d="M10 21v-6h4v6" />
            </svg>
          </button>
          {/* 全库关键字检索入口：与返回首页按钮并排 */}
          <button
            className="sidebar-home-btn"
            onClick={() => setGlobalSearchOpen(true)}
            title="全文档关键字检索"
            aria-label="全文档关键字检索"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
          </button>
          {/* 操作日志入口：从右侧 header 迁移到侧边栏顶部 */}
          <button
            className="sidebar-home-btn"
            onClick={onOpenLogs}
            title="查看操作日志"
            aria-label="查看操作日志"
            disabled={!onOpenLogs}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          </button>
          {/* 随机一题入口：从右侧 header 迁移到侧边栏顶部 */}
          <button
            className="sidebar-home-btn"
            onClick={onOpenRandom}
            title="随机抽取一道题目进行练习"
            aria-label="随机一题"
            disabled={!onOpenRandom}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </button>
          {/* 最近浏览入口：下拉展示最近打开过的文档（分类题目 / project 文档 / 外部文档，localStorage 记录，最多 10 条） */}
          <button
            className="sidebar-home-btn"
            onClick={toggleRecent}
            title="最近浏览"
            aria-label="最近浏览"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.5 4" />
              <path d="M3 3v4h4" />
              <path d="M12 7v5l3 3" />
            </svg>
          </button>
          {/* 最近浏览下拉列表：点击条目按文档类型一键跳回（分类题目 / project 文档 / 外部文档） */}
          {recentOpen && (
            <div className="sidebar-recent-dropdown">
              {recentList.length === 0 ? (
                <div className="sidebar-recent-empty">暂无浏览记录</div>
              ) : (
                recentList.map((item) => {
                  // 按文档类型解析归属名称：分类题目取分类显示名，project 文档取子目录名，外部文档固定显示「外部文档」
                  const scopeName =
                    item.kind === 'project'
                      ? projectSubdirs.find((s) => s.slug === item.category)?.slug || item.category
                      : item.kind === 'external'
                      ? '外部文档'
                      : categories.find((c) => c.slug === item.category)?.name || item.category;
                  return (
                    <button
                      key={`${item.kind}:${item.category}/${item.filename}`}
                      className="sidebar-recent-item"
                      onClick={() => {
                        setRecentOpen(false);
                        // 按文档类型分发跳转：分类题目 / project 文档 / 外部文档
                        if (item.kind === 'project') onSelectProgram?.(item.category, item.filename);
                        else if (item.kind === 'external') onSelectExternalDoc?.(item.filename);
                        else onSelectQuestion(item.category, item.filename);
                      }}
                      title={`${item.title}（${scopeName}）`}
                    >
                      <span className="sidebar-recent-title">{item.title}</span>
                      <span className="sidebar-recent-meta">{scopeName} · {formatRelativeTime(item.ts)}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        {/* 折叠/展开侧边栏：展开时收起为最左侧图标栏，折叠后点击图标栏按钮展开 */}
        <button
          className="sidebar-home-btn"
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          disabled={!onToggleCollapse}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
            <path d={collapsed ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'} />
          </svg>
        </button>
      </div>

      {/* 折叠态只保留顶部功能按钮图标栏，以下栏目内容全部隐藏 */}
      {!collapsed && (
      <>
      {/* 待入库题单：面试题收集入口（位于分类上方） */}
      <div className="sidebar-section inbox-entry-section">
        <button
          className={`sidebar-item inbox-entry${inboxActive ? ' active' : ''}`}
          onClick={onOpenInbox}
          title="收集待入库的面试题（持久化为 Markdown）"
        >
          <span className="inbox-entry-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            待入库题单
          </span>
          {inboxPending > 0 && <span className="badge">{inboxPending}</span>}
        </button>
      </div>

      {/* 分类 */}
      <div className="sidebar-section sidebar-cats">
        <div className="sidebar-section-title">
          <button className="sidebar-group-title" onClick={() => toggleSection('categories')} title="Categories">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Categories</span>
            <span className="badge">{categories.length}</span>
          </button>
          <button className="sidebar-add-btn" onClick={() => openForm('category')} title="新建分类" aria-label="新建分类">+</button>
        </div>
        {!collapsedSections.has('categories') && categories.map((cat) => (
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
              <span className="sidebar-cat-dot" />
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
        <div className="sidebar-section-title">
          <button className="sidebar-group-title" onClick={() => toggleSection('tags')} title="Tags">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Tags</span>
            <span className="badge">{tags.length}</span>
          </button>
        </div>
        {!collapsedSections.has('tags') && tags.slice(0, 20).map((tag) => (
          <div
            key={tag.name}
            className="sidebar-item" style={{ fontSize: 12, cursor: "pointer" }} onClick={() => onSelectTag?.(tag.name)}
            title={`${tag.name} — ${tag.questions.length} 道题目`}
          >
            <span># {tag.name}</span>
            <span className="badge">{tag.questions.length}</span>
          </div>
        ))}
        {!collapsedSections.has('tags') && tags.length > 20 && (
          <div className="sidebar-item sidebar-more">还有 {tags.length - 20} 个标签...</div>
        )}
      </div>

      {/* project 伞形区块：普通子目录 */}
      {projectSubdirs.filter(s => !s.isGroup).length > 0 && (
        <div className="sidebar-section sidebar-projects">
          <div className="sidebar-section-title">
            <button className="sidebar-group-title" onClick={() => toggleSection('project')} title="project">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>project</span>
              <span className="badge">{projectSubdirs.filter(s => !s.isGroup).length}</span>
            </button>
            <button className="sidebar-add-btn" onClick={() => openForm('project-subdir')} title="新建 project 子目录" aria-label="新建子目录">+</button>
          </div>
          {!collapsedSections.has('project') && projectSubdirs.filter(s => !s.isGroup).map((subdir) => (
            <div
              key={subdir.slug}
              data-sidebar-project-dir={subdir.slug}
              className={`sidebar-project-dir ${projectDrag.state.drop?.category === subdir.slug ? 'drag-target-cat' : ''}`}
              onPointerDown={projectDrag.onPointerDown}
            >
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
                <span className="sidebar-cat-dot" />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {subdir.slug}
                </span>
                <span className="badge">{subdir.docs.length}</span>
              </button>
              {expandedProjectSubdirs.has(subdir.slug) && (
                <div>
                  {subdir.docs.map((doc) => (
                    <button
                      key={`${subdir.slug}/${doc.filename}`}
                      data-sidebar-project-draggable=""
                      data-cat-slug={subdir.slug}
                      data-filename={doc.filename}
                      data-title={doc.title}
                      className={`sidebar-item sidebar-sub ${projectDrag.state.item?.filename === doc.filename && projectDrag.state.item?.category === subdir.slug ? 'drag-source' : ''}`}
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
              {projectDrag.state.drop?.category === subdir.slug && (
                <div className="sidebar-drop-indicator" style={{ top: projectDrag.state.drop.indicatorTop }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 分组：每个分组作为独立区块 */}
      {projectSubdirs.filter(s => s.isGroup).map((subdir) => (
        <div
          className={`sidebar-section sidebar-projects sidebar-project-dir ${projectDrag.state.drop?.category === subdir.slug ? 'drag-target-cat' : ''}`}
          key={subdir.slug}
          data-sidebar-project-dir={subdir.slug}
          onPointerDown={projectDrag.onPointerDown}
        >
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
          </div>
          {expandedProjectSubdirs.has(subdir.slug) && (
            <div>
              {subdir.docs.map((doc) => (
                <button
                  key={`${subdir.slug}/${doc.filename}`}
                  data-sidebar-project-draggable=""
                  data-cat-slug={subdir.slug}
                  data-filename={doc.filename}
                  data-title={doc.title}
                  className={`sidebar-item sidebar-sub ${projectDrag.state.item?.filename === doc.filename && projectDrag.state.item?.category === subdir.slug ? 'drag-source' : ''}`}
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
          {projectDrag.state.drop?.category === subdir.slug && (
            <div className="sidebar-drop-indicator" style={{ top: projectDrag.state.drop.indicatorTop }} />
          )}
        </div>
      ))}

      {/* 外部文档：本机任意位置 md 的路径索引，按分组折叠展示，支持拖拽排序/跨分组移动 */}
      <div className="sidebar-section sidebar-external">
        <div className="sidebar-section-title">
          <span
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectExternalList?.()}
            title="查看外部文档列表"
          >
            外部文档 ({externalDocs.length})
          </span>
          {/* + 号与分类栏目一致：新建分组（新增文档入口在各分组内部） */}
          <button
            className="sidebar-add-btn"
            onClick={() => { setExtGroupName(''); setExtGroupError(''); setExtGroupModal({ mode: 'create' }); }}
            title="新建外部文档分组"
            aria-label="新建外部文档分组"
          >+</button>
        </div>
        {externalDocs.length === 0 && externalGroups.length === 0 && (
          <div className="sidebar-item" style={{ fontSize: 12, color: '#999', cursor: 'default' }}>
            暂无外部文档，点击 + 新建分组
          </div>
        )}
        {(externalDocs.length > 0 || externalGroups.length > 0) && (
          <>
            {externalGroups.map((groupName) => renderExtGroupSection(groupName))}
            {renderExtGroupSection('')}
          </>
        )}
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
      </>
      )}

      {/* 添加外部文档弹窗 */}
      {addExternalOpen && (
        <div className="sidebar-modal-overlay" onClick={() => !addingExternal && !picking && setAddExternalOpen(false)}>
          <div className="sidebar-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">
              索引外部 MD 文档
              <span style={{ fontWeight: 400, color: '#8c7e9d' }}>
                {addExternalGroup ? ` → 加入分组「${addExternalGroup}」` : ' → 加入未分组'}
              </span>
            </div>
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

      {/* 外部文档分组新建/改名弹窗 */}
      {extGroupModal && (
        <div className="sidebar-modal-overlay" onClick={() => !extGroupBusy && setExtGroupModal(null)}>
          <div className="sidebar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-modal-title">
              {extGroupModal.mode === 'create' ? '新建外部文档分组' : '重命名分组'}
            </div>
            <div className="sidebar-modal-body">
              <label style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 4 }}>
                {extGroupModal.mode === 'create'
                  ? '创建后可在侧边栏将外部文档拖拽进该分组'
                  : '重命名后组内文档自动跟随，索引与文件均不受影响'}
              </label>
              <input
                className="sidebar-modal-input"
                value={extGroupName}
                onChange={(e) => setExtGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitExtGroup(); }}
                placeholder="分组名称"
                autoFocus
              />
            </div>
            {extGroupError && (
              <div style={{ color: '#e03131', fontSize: 12, marginBottom: 8 }}>{extGroupError}</div>
            )}
            <div className="sidebar-modal-actions">
              <button className="btn btn-small btn-secondary" onClick={() => setExtGroupModal(null)} disabled={extGroupBusy}>取消</button>
              <button className="btn btn-small btn-primary" onClick={submitExtGroup} disabled={extGroupBusy || !extGroupName.trim()}>
                {extGroupBusy ? '保存中...' : '保存'}
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

      {/* 全库关键字检索弹窗 */}
      {globalSearchOpen && (
        <GlobalSearchModal
          onClose={() => setGlobalSearchOpen(false)}
          onSelectQuestion={(cat, filename) => { setGlobalSearchOpen(false); onSelectQuestion(cat, filename); }}
          onSelectProgram={(subdir, filename) => { setGlobalSearchOpen(false); onSelectProgram?.(subdir, filename); }}
          onSelectExternalDoc={(id) => { setGlobalSearchOpen(false); onSelectExternalDoc?.(id); }}
        />
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
      {projectDrag.state.phase !== 'idle' && projectDrag.state.item && createPortal(
        <div
          ref={projectDrag.ghostRef}
          className="sidebar-drag-ghost"
          style={{
            left: -12,
            top: -18,
            transform: `translate3d(${projectDrag.state.ghost?.x ?? 0}px, ${projectDrag.state.ghost?.y ?? 0}px, 0) scale(1.04)`,
          }}
        >
          <span className="sidebar-question-index">{projectDrag.state.item.chip}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectDrag.state.item.title}
          </span>
        </div>,
        document.body,
      )}
      {externalDrag.state.phase !== 'idle' && externalDrag.state.item && createPortal(
        <div
          ref={externalDrag.ghostRef}
          className="sidebar-drag-ghost"
          style={{
            left: -12,
            top: -18,
            transform: `translate3d(${externalDrag.state.ghost?.x ?? 0}px, ${externalDrag.state.ghost?.y ?? 0}px, 0) scale(1.04)`,
          }}
        >
          <span className="sidebar-question-index">{externalDrag.state.item.chip}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {externalDrag.state.item.title}
          </span>
        </div>,
        document.body,
      )}
    </aside>
  );
}

/** 外部文档拖拽移动时的乐观列表更新（docs 数组顺序即分组内显示顺序）。 */
function reorderExternalDocs(
  prev: ExternalDocInfo[],
  docId: string,
  toGroup: string,
  toIndex: number,
): ExternalDocInfo[] {
  const idx = prev.findIndex((d) => d.id === docId);
  if (idx < 0) return prev;
  const moved = { ...prev[idx], group: toGroup };
  const rest = prev.filter((d) => d.id !== docId);
  // 目标分组剩余条目（保持原顺序）
  const remaining = rest.filter((d) => (d.group || '') === toGroup);
  const clamped = Math.max(0, Math.min(toIndex, remaining.length));
  // 插入锚点：第 toIndex 条之前；追加则放同分组最后一条之后；分组为空则放列表末尾
  let insertAt: number;
  if (remaining.length === 0) {
    insertAt = rest.length;
  } else if (clamped < remaining.length) {
    insertAt = rest.indexOf(remaining[clamped]);
  } else {
    insertAt = rest.indexOf(remaining[remaining.length - 1]) + 1;
  }
  const next = [...rest];
  next.splice(insertAt, 0, moved);
  return next;
}

/** project/分组文档拖拽时的乐观列表更新。 */
function reorderProjectSubdirs(
  prev: ProjectSubdir[],
  fromSubdir: string,
  filename: string,
  toSubdir: string,
  toIndex: number,
): ProjectSubdir[] {
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
