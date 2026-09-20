'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CategoryInfo, TagInfo, ProjectSubdir, ExternalDocInfo } from '@/lib/types';
import { useSidebarDrag } from './useSidebarDrag';
import GlobalSearchModal from './GlobalSearchModal';
import { getRecent, type RecentEntry } from '@/lib/recent';
import { reorderExternalDocs, reorderProjectSubdirs } from '@/lib/reorderDocuments';
import SidebarHeader from './SidebarHeader';
import { ExternalAddModal, ExternalGroupModal, SidebarCreateModal } from './SidebarModals';

interface Props {
  categories: CategoryInfo[];
  tags: TagInfo[];
  projectData: ProjectSubdir[];
  externalData: ExternalDocInfo[];
  externalGroupsData: string[];
  inboxPending: number;
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
  onInboxRefresh?: () => void;
  inboxActive?: boolean;
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

export default function Sidebar({
  categories,
  tags,
  projectData,
  externalData,
  externalGroupsData,
  inboxPending,
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
  onInboxRefresh,
  inboxActive,
  onMoveQuestion,
  onMoveProjectDoc,
}: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedProjectSubdirs, setExpandedProjectSubdirs] = useState<Set<string>>(new Set());
  // 栏目整体折叠状态：categories=分类栏目，project=project 栏目，tags=标签栏目
  const [collapsedSections, setCollapsedSections] = useState<Set<'categories' | 'project' | 'tags'>>(new Set());
  const [projectSubdirs, setProjectSubdirs] = useState<ProjectSubdir[]>(projectData);
  const [externalDocs, setExternalDocs] = useState<ExternalDocInfo[]>(externalData);
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
  const [externalGroups, setExternalGroups] = useState<string[]>(externalGroupsData);
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

  useEffect(() => setProjectSubdirs(projectData), [projectData]);
  useEffect(() => setExternalDocs(externalData), [externalData]);
  useEffect(() => setExternalGroups(externalGroupsData), [externalGroupsData]);

  // 题单内容变化（加入新题 / 勾选入库）时刷新待处理徽标
  useEffect(() => {
    if (!onInboxRefresh) return;
    window.addEventListener('inbox-changed', onInboxRefresh);
    return () => window.removeEventListener('inbox-changed', onInboxRefresh);
  }, [onInboxRefresh]);

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
      <SidebarHeader
        collapsed={collapsed}
        recentOpen={recentOpen}
        recentList={recentList}
        recentMenuRef={recentMenuRef}
        categories={categories}
        projectSubdirs={projectSubdirs}
        onGoHome={onGoHome}
        onOpenSearch={() => setGlobalSearchOpen(true)}
        onOpenLogs={onOpenLogs}
        onOpenRandom={onOpenRandom}
        onToggleRecent={toggleRecent}
        onToggleCollapse={onToggleCollapse}
        onCloseRecent={() => setRecentOpen(false)}
        onSelectQuestion={onSelectQuestion}
        onSelectProgram={onSelectProgram}
        onSelectExternalDoc={onSelectExternalDoc}
      />

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

      {addExternalOpen && (
        <ExternalAddModal
          group={addExternalGroup}
          paths={externalPathsText}
          busy={addingExternal}
          picking={picking}
          error={externalError}
          onPathsChange={setExternalPathsText}
          onPick={pickFromDialog}
          onSubmit={handleAddExternal}
          onClose={() => setAddExternalOpen(false)}
        />
      )}

      {extGroupModal && (
        <ExternalGroupModal
          mode={extGroupModal.mode}
          name={extGroupName}
          busy={extGroupBusy}
          error={extGroupError}
          onNameChange={setExtGroupName}
          onSubmit={submitExtGroup}
          onClose={() => setExtGroupModal(null)}
        />
      )}

      {createForm && (
        <SidebarCreateModal
          title={createForm.type === "category" ? "新建分类" : createForm.type === "project-subdir" ? "新建 project 子目录" : createForm.type === "group" ? "新建分组" : "新建文档"}
          needsSlug={needsSlug}
          slug={formSlug}
          slugPlaceholder={slugify(formName)}
          name={formName}
          busy={creating}
          error={formError}
          onSlugChange={setFormSlug}
          onNameChange={setFormName}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
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
