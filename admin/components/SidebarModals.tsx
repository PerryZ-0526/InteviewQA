'use client';

export function ExternalAddModal({
  group,
  paths,
  busy,
  picking,
  error,
  onPathsChange,
  onPick,
  onSubmit,
  onClose,
}: {
  group: string;
  paths: string;
  busy: boolean;
  picking: 'file' | 'folder' | null;
  error: string;
  onPathsChange: (value: string) => void;
  onPick: (mode: 'file' | 'folder') => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sidebar-modal-overlay" onClick={() => !busy && !picking && onClose()}>
      <div className="sidebar-modal sidebar-modal-wide" onClick={(event) => event.stopPropagation()}>
        <div className="sidebar-modal-title">
          索引外部 MD 文档
          <span className="sidebar-modal-subtitle">
            {group ? ` → 加入分组「${group}」` : ' → 加入未分组'}
          </span>
        </div>
        <div className="sidebar-modal-body">
          <div className="sidebar-modal-picker-row">
            <button className="btn btn-small btn-primary" onClick={() => onPick('file')} disabled={!!picking || busy}>
              {picking === 'file' ? '等待选择…' : '选择文件…'}
            </button>
            <button className="btn btn-small btn-primary" onClick={() => onPick('folder')} disabled={!!picking || busy}>
              {picking === 'folder' ? '等待选择…' : '选择文件夹…'}
            </button>
            {picking && <span className="sidebar-modal-picker-hint">请在弹出的资源管理器窗口中完成选择</span>}
          </div>
          <label className="sidebar-modal-label">
            或手动粘贴 .md 文件/文件夹完整路径，每行一个（文件夹会递归扫描其中的 .md）
          </label>
          <textarea
            className="sidebar-modal-input sidebar-modal-textarea"
            value={paths}
            onChange={(event) => onPathsChange(event.target.value)}
            placeholder={'D:\\notes\\设计文档.md\nD:\\blog\\posts'}
            autoFocus
          />
          <div className="sidebar-modal-help">
            文档保留在原位置，本项目仅记录路径。文件被移动或重命名后索引将失效并提示原位置。
          </div>
        </div>
        {error && <div className="sidebar-modal-error">{error}</div>}
        <div className="sidebar-modal-actions">
          <button className="btn btn-small btn-secondary" onClick={onClose} disabled={busy || !!picking}>取消</button>
          <button className="btn btn-small btn-primary" onClick={onSubmit} disabled={busy || !!picking || !paths.trim()}>
            {busy ? '扫描中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExternalGroupModal({
  mode,
  name,
  busy,
  error,
  onNameChange,
  onSubmit,
  onClose,
}: {
  mode: 'create' | 'rename';
  name: string;
  busy: boolean;
  error: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sidebar-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="sidebar-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sidebar-modal-title">{mode === 'create' ? '新建外部文档分组' : '重命名分组'}</div>
        <div className="sidebar-modal-body">
          <label className="sidebar-modal-label">
            {mode === 'create'
              ? '创建后可在侧边栏将外部文档拖拽进该分组'
              : '重命名后组内文档自动跟随，索引与文件均不受影响'}
          </label>
          <input
            className="sidebar-modal-input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
            placeholder="分组名称"
            autoFocus
          />
        </div>
        {error && <div className="sidebar-modal-error">{error}</div>}
        <div className="sidebar-modal-actions">
          <button className="btn btn-small btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-small btn-primary" onClick={onSubmit} disabled={busy || !name.trim()}>
            {busy ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SidebarCreateModal({
  title,
  needsSlug,
  slug,
  slugPlaceholder,
  name,
  busy,
  error,
  onSlugChange,
  onNameChange,
  onSubmit,
  onClose,
}: {
  title: string;
  needsSlug: boolean;
  slug: string;
  slugPlaceholder: string;
  name: string;
  busy: boolean;
  error: string;
  onSlugChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sidebar-modal-overlay" onClick={onClose}>
      <div className="sidebar-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sidebar-modal-title">{title}</div>
        <div className="sidebar-modal-body">
          {needsSlug && (
            <div className="sidebar-modal-field">
              <label className="sidebar-modal-label">目录名</label>
              <input
                className="sidebar-modal-input"
                value={slug}
                onChange={(event) => onSlugChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
                placeholder={slugPlaceholder || 'english-slug'}
              />
            </div>
          )}
          <div>
            <label className="sidebar-modal-label">{needsSlug ? '显示名' : '标题'}</label>
            <input
              className="sidebar-modal-input"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
              placeholder={needsSlug ? '显示名称' : '文档标题'}
              autoFocus
            />
          </div>
        </div>
        {error && <div className="sidebar-modal-error">{error}</div>}
        <div className="sidebar-modal-actions">
          <button className="btn btn-small btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-small btn-primary" onClick={onSubmit} disabled={busy || !name.trim()}>
            {busy ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
