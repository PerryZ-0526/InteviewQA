'use client';

import { useState, useEffect } from 'react';
import { LogEntry } from '@/lib/logger';

export default function LogViewer({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/logs?limit=100');
      const json = await res.json();
      if (json.success) setLogs(json.data);
    } catch {}
    if (!silent) setLoading(false);
  };

  useEffect(() => { loadLogs(); }, []);

  // 有 running 行时每 5s 静默轮询：服务端对账会收敛状态，收敛后自动停止
  const hasRunning = logs.some((l) => l.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => loadLogs(true), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRunning]);

  const abandon = async (taskId: string) => {
    if (!confirm('确认放弃生成？已消耗的额度不会退还。')) return;
    try {
      await fetch(`/api/tasks/${taskId}`, { method: 'POST' });
    } catch {}
    loadLogs(true);
  };

  const actionLabel = (action: string) => {
    switch (action) {
      case 'create_question': return '新增题目';
      case 'update_question': return '更新题目';
      case 'delete_question': return '删除题目';
      case 'create_empty': return '新建空文档';
      case 'answer_random': return '随机作答';
      case 'annotation_add': return '添加批注';
      case 'annotation_edit': return '编辑批注';
      case 'annotation_delete': return '删除批注';
      case 'annotation_update': return '更新批注';
      case 'create_project_subdir': return '新建project子目录';
      case 'create_project_doc': return '新建project文档';
      case 'project_doc_update': return '更新project文档';
      case 'external_add': return '添加外部文档';
      case 'external_update': return '更新外部文档';
      case 'external_remove': return '移除外部文档索引';
      case 'external_rename': return '重命名外部文档';
      default: return action;
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'success') return '成功';
    if (status === 'running') return '执行中';
    return '失败';
  };

  return (
    <div className="modal-overlay log-overlay" onClick={onClose}>
      <div className="log-viewer" onClick={e => e.stopPropagation()}>
        <div className="log-viewer-header">
          <div className="log-viewer-heading">
            <div className="log-viewer-icon">≡</div>
            <div>
              <span className="log-viewer-kicker">ACTIVITY</span>
              <h3>操作日志</h3>
              <p>{loading ? '正在读取最近记录…' : `最近 ${logs.length} 条操作记录`}</p>
            </div>
          </div>
          <div className="log-viewer-actions">
            <button type="button" className="log-refresh" onClick={() => loadLogs()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
            <button type="button" className="log-clear" onClick={async () => { if (confirm('确认清空所有日志？')) { await fetch('/api/logs', { method: 'DELETE' }); loadLogs(); } }}>清空</button>
            <button type="button" className="log-close" aria-label="关闭操作日志" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="log-viewer-body">
          {loading ? (
            <div className="loading-overlay" style={{ padding: 30 }}>
              <div className="loading-spinner" />
            </div>
          ) : logs.length === 0 ? (
            <div className="log-empty">
              <span>≡</span>
              <p>暂无日志</p>
              <small>完成新增、删除或随机作答后，记录会显示在这里</small>
            </div>
          ) : (
            <table className="log-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>时间</th>
                  <th style={{ width: 80 }}>操作</th>
                  <th style={{ width: 50 }}>状态</th>
                  <th style={{ width: 100 }}>分类</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={i}>
                    <td className="log-time">{log.timestamp}</td>
                    <td>
                      <span className="log-action">{actionLabel(log.action)}</span>
                      {(log as any).count > 1 && <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>×{(log as any).count}</span>}
                    </td>
                    <td><span className={`log-status ${log.status}`}>{statusLabel(log.status)}</span></td>
                    <td><span className="log-category">{log.category || '未分类'}</span></td>
                    <td>
                      <div className="log-detail">
                        {log.filename && <span className="log-filename">{log.filename}</span>}
                        {log.question && <span className="log-question">{log.question}</span>}
                        {log.error && <span className="log-error">{log.error}</span>}
                        {log.detail && <span className="log-question">{log.detail}</span>}
                        {log.status === 'running' && log.taskId && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            style={{ marginTop: 6 }}
                            onClick={() => abandon(log.taskId!)}
                          >
                            放弃
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
