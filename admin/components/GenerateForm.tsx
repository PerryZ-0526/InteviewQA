'use client';

import { useState, useEffect } from 'react';
import { CategoryInfo, TagInfo } from '@/lib/types';

interface Props {
  categories: CategoryInfo[];
  tags: TagInfo[];
  onGenerated: (filePath: string, content: string) => void;
  onCancel: () => void;
  onGeneratingChange: (generating: boolean) => void;
}

export default function GenerateForm({ categories, tags, onGenerated, onCancel, onGeneratingChange }: Props) {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [extraRequirements, setExtraRequirements] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [includeAnswer, setIncludeAnswer] = useState(true);
  const [includeAnalysis, setIncludeAnalysis] = useState(true);
  const [generatingSince, setGeneratingSince] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const allTagNames = Array.from(new Set([...tags.map((t) => t.name), ...selectedTags])).sort();

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - generatingSince) / 1000)), 1000);
    return () => clearInterval(t);
  }, [generating, generatingSince]);

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const addNewTag = () => { if (newTagInput.trim() && !selectedTags.includes(newTagInput.trim())) setSelectedTags((prev) => [...prev, newTagInput.trim()]); setNewTagInput(''); };

  const handleGenerate = async () => {
    if (!question.trim()) { setError('请输入题目描述'); return; }
    setError('');
    setGenerating(true);
    const start = Date.now();
    setGeneratingSince(start);
    setElapsed(0);
    onGeneratingChange(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), category: category || '', tags: selectedTags, extraRequirements: extraRequirements.trim(), includeAnswer, includeAnalysis }),
      });
      const json = await res.json();
      if (json.success) { onGenerated(json.filePath, json.content); }
      else { setError(json.error || '生成失败'); if (json.output) console.error('Claude output:', json.output); }
    } catch (e: any) { setError('请求失败: ' + e.message); }
    finally { setGenerating(false); onGeneratingChange(false); }
  };

  return (
    <div className="gen-form">
      {/* 页面标题 */}
      <div className="gen-header">
        <div className="gen-header-left">
          <div className="gen-icon">✦</div>
          <div>
            <span className="gen-kicker">QUESTION STUDIO</span>
            <h2 className="gen-title">新建面试真题</h2>
            <p className="gen-subtitle">描述题目和偏好，AI 将完成答案解析与知识库归档</p>
          </div>
        </div>
        <button type="button" className="gen-close" aria-label="关闭新增题目页面" onClick={onCancel} disabled={generating}>×</button>
      </div>

      {/* 表单主体 */}
      <div className="gen-body">
        {/* 第一步：题目描述 */}
        <div className="gen-step">
          <div className="gen-step-num">01</div>
          <div className="gen-step-content">
            <label className="gen-label">题目描述 *</label>
            <textarea
              className="gen-textarea"
              rows={3}
              placeholder="例如：如何降低 Agent 的运营成本？"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={generating}
            />
          </div>
        </div>

        {/* 第二步：额外要求 */}
        <div className="gen-step">
          <div className="gen-step-num">02</div>
          <div className="gen-step-content">
            <label className="gen-label">额外要求 <span className="gen-optional">可选</span></label>
            <textarea
              className="gen-textarea"
              rows={2}
              placeholder="例如：多用代码示例、侧重实际落地场景、语言更简洁..."
              value={extraRequirements}
              onChange={(e) => setExtraRequirements(e.target.value)}
              disabled={generating}
            />
          </div>
        </div>

        {/* 生成范围 */}
        <div className="gen-step">
          <div className="gen-step-num"></div>
          <div className="gen-step-content">
            <label className="gen-label">生成范围 <span className="gen-optional">勾选需要 AI 撰写的章节</span></label>
            <div className="gen-tags" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`gen-tag${includeAnswer ? ' active' : ''}`}
                aria-pressed={includeAnswer}
                onClick={() => setIncludeAnswer(!includeAnswer)}
                disabled={generating}
              >面试直接答</button>
              <button
                type="button"
                className={`gen-tag${includeAnalysis ? ' active' : ''}`}
                aria-pressed={includeAnalysis}
                onClick={() => setIncludeAnalysis(!includeAnalysis)}
                disabled={generating}
              >详细解析</button>
              <button
                type="button"
                className="gen-tag"
                onClick={() => {
                  const allOn = includeAnswer && includeAnalysis;
                  setIncludeAnswer(!allOn);
                  setIncludeAnalysis(!allOn);
                }}
                disabled={generating}
                style={{ fontSize: 11, opacity: 0.7 }}
              >{includeAnswer && includeAnalysis ? '全部取消' : '全部勾选'}</button>
            </div>
          </div>
        </div>

        {/* 第三步：分类和标签 */}
        <div className="gen-step">
          <div className="gen-step-num">03</div>
          <div className="gen-step-content">
            <label className="gen-label">分类和标签 <span className="gen-optional">可选，不填则 AI 自动判断</span></label>
            <div className="gen-row">
              <select className="gen-select" value={category} onChange={(e) => setCategory(e.target.value)} disabled={generating}>
                <option value="">-- 自动判断分类 --</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.questionCount} 题)</option>)}
              </select>
            </div>
            <div className="gen-tags">
              {allTagNames.map((tag) => (
                <button type="button" key={tag} className={`gen-tag ${selectedTags.includes(tag) ? 'active' : ''}`} aria-pressed={selectedTags.includes(tag)} onClick={() => toggleTag(tag)} disabled={generating}>{tag}</button>
              ))}
            </div>
            <div className="gen-row">
              <input className="gen-input" placeholder="新标签..." value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag(); } }} disabled={generating} />
              <button className="btn btn-secondary btn-small" onClick={addNewTag} disabled={generating || !newTagInput.trim()} type="button">添加</button>
            </div>
          </div>
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="gen-footer">
        <div className="gen-footer-info">
          {error ? <div className="gen-error">{error}</div> : (
            <p className="gen-hint">{generating ? '正在分析题目、撰写答案并更新索引…' : '生成后仍可在编辑器中继续调整内容'}</p>
          )}
        </div>
        <button className="gen-submit" onClick={handleGenerate} disabled={generating || !question.trim()}>
          {generating ? (
            <><span className="gen-spinner" />生成中 · {Math.floor(elapsed / 60)}分{elapsed % 60}秒</>
          ) : (
            <>✦ 生成答案</>
          )}
        </button>
      </div>
    </div>
  );
}
