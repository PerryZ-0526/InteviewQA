'use client';

// 顶部阅读位置恢复提示条：文档重新打开时，若存在持久化的上次阅读位置，
// 在文档区顶部弹出询问条（样式复用标签会话恢复条 .tab-restore-bar），
// 用户点「恢复位置」跳回上次位置，点「从头阅读」留在顶部。
// pct 为该位置占文档总高的百分比（0-100）；null 表示旧版记录未存百分比，退回模糊文案。

interface Props {
  pct: number | null;
  onRestore: () => void;
  onDismiss: () => void;
}

export default function ScrollRestoreBar({ pct, onRestore, onDismiss }: Props) {
  return (
    <div className="tab-restore-bar">
      <span className="tab-restore-icon" aria-hidden="true">📍</span>
      <span className="tab-restore-text">
        {pct != null
          ? `上次阅读到文档约 ${pct}% 处，是否恢复到上次的阅读位置？`
          : '上次阅读到文档中部，是否恢复到上次的阅读位置？'}
      </span>
      <div className="tab-restore-actions">
        <button className="btn btn-primary btn-small" onClick={onRestore}>
          恢复位置
        </button>
        <button className="btn btn-secondary btn-small" onClick={onDismiss}>
          从头阅读
        </button>
      </div>
    </div>
  );
}
