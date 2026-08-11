'use client';

import { useState } from 'react';
import { CategoryInfo } from '@/lib/types';

interface Props {
  categories: CategoryInfo[];
  onCreated: (filePath: string, content: string) => void;
  onCancel: () => void;
}

export default function CreateEmptyModal({ categories, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
    }
    setTagInput('');
  };

  const create = async () => {
    if (!title.trim()) { setError('请输入标题'); return; }
    if (!category) { setError('请选择分类'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/categories/${category}/empty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), tags }),
      });
      const json = await res.json();
      if (json.success) {
        onCreated(`categories/${json.category}/${json.filename}`, json.content || '');
      } else {
        setError(json.error || '创建失败');
      }
    } catch (e: any) {
      setError('请求失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-popup-overlay" onClick={onCancel}>
      <div className="ai-popup" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="ai-popup-header">
          <div className="ai-popup-brand">
            <span className="ai-popup-mark" style={{ opacity: 0.6 }}>📄</span>
            <div>
              <div className="ai-popup-title">新建空文档</div>
              <div className="ai-popup-subtitle">创建空白题目文件，之后再编辑内容</div>
            </div>
          </div>
          <button type="button" className="ai-popup-close" onClick={onCancel}>×</button>
        </div>

        <div className="ai-popup-body">
          <section className="ai-selection-card">
            <label className="ai-section-label" htmlFor="empty-title">标题 *</label>
            <input id="empty-title" className="gen-input" placeholder="例如：如何设计一个高并发缓存系统？" value={title} onChange={e => setTitle(e.target.value)} disabled={loading} style={{ width: '100%', boxSizing: 'border-box' }} />
          </section>

          <section className="ai-selection-card" style={{ marginTop: 12 }}>
            <label className="ai-section-label" htmlFor="empty-cat">分类 *</label>
            <select id="empty-cat" className="gen-select" value={category} onChange={e => setCategory(e.target.value)} disabled={loading} style={{ width: '100%', boxSizing: 'border-box' }}>
              <option value="">-- 选择分类 --</option>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.name} ({c.questionCount} 题)</option>)}
            </select>
          </section>

          <section className="ai-selection-card" style={{ marginTop: 12 }}>
            <label className="ai-section-label">标签 <span className="gen-optional">可选</span></label>
            <div className="gen-row" style={{ marginTop: 4 }}>
              <input className="gen-input" placeholder="输入后回车添加" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} disabled={loading} style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-small" onClick={addTag} disabled={loading || !tagInput.trim()}>添加</button>
            </div>
            {tags.length > 0 && (
              <div className="gen-tags" style={{ marginTop: 8 }}>
                {tags.map(t => (
                  <button key={t} type="button" className="gen-tag active" aria-pressed="true" onClick={() => setTags(tags.filter(x => x !== t))} disabled={loading}>{t} ×</button>
                ))}
              </div>
            )}
          </section>

          {error && <div className="gen-error" style={{ marginTop: 12 }}>{error}</div>}

          <div className="ai-popup-actions ai-input-actions" style={{ marginTop: 16 }}>
            <button type="button" className="ai-text-button" onClick={onCancel} disabled={loading}>取消</button>
            <button type="button" className="ai-send-button" onClick={create} disabled={loading || !title.trim() || !category}>
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
