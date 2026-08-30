'use client';

// 顶部标签会话恢复提示条：浏览器「恢复上次关闭的标签页？」式询问。
// 用户点「恢复」重建上次会话，点「不恢复」清除记录，不再打扰。

interface Props {
  count: number;
  onRestore: () => void;
  onDismiss: () => void;
}

export default function TabRestoreBar({ count, onRestore, onDismiss }: Props) {
  return (
    <div className="tab-restore-bar">
      <span className="tab-restore-icon" aria-hidden="true">↻</span>
      <span className="tab-restore-text">
        上次会话打开了 <b>{count}</b> 个标签页，是否恢复？
      </span>
      <div className="tab-restore-actions">
        <button className="btn btn-primary btn-small" onClick={onRestore}>
          恢复标签页
        </button>
        <button className="btn btn-secondary btn-small" onClick={onDismiss}>
          不恢复
        </button>
      </div>
    </div>
  );
}
