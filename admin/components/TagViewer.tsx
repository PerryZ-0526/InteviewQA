'use client';

import { useState, useEffect } from 'react';

interface QuestionLink {
  filename: string;
  title: string;
  category: string;
}

interface Props {
  tagName: string;
  onBack: () => void;
  onOpenQuestion: (category: string, filename: string) => void;
}

export default function TagViewer({ tagName, onBack, onOpenQuestion }: Props) {
  const [questions, setQuestions] = useState<QuestionLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/tags');
        const json = await res.json();
        if (json.success) {
          const tag = json.data.find((t: any) => t.name === tagName);
          setQuestions(tag?.questions || []);
        }
      } catch {}
      setLoading(false);
    })();
  }, [tagName]);

  // Group by category
  const grouped: Record<string, QuestionLink[]> = {};
  for (const q of questions) {
    if (!grouped[q.category]) grouped[q.category] = [];
    grouped[q.category].push(q);
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="tag-viewer-header">
        <button className="btn btn-secondary btn-small" onClick={onBack}>← 返回</button>
        <h2># {tagName}</h2>
        <span style={{ fontSize: 13, color: '#999' }}>{questions.length} 道题目</span>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="loading-spinner" /></div>
      ) : questions.length === 0 ? (
        <div className="empty-state"><p>该标签下暂无题目</p></div>
      ) : (
        <div>
          {Object.entries(grouped).map(([cat, qs]) => (
            <div key={cat} style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                {cat}
              </h3>
              <div className="card" style={{ padding: 0 }}>
                {qs.map((q) => (
                  <div
                    key={q.filename}
                    className="question-list-item"
                    onClick={() => onOpenQuestion(q.category, q.filename)}
                  >
                    <span className="filename">{q.filename}</span>
                    <span className="title">{q.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>打开 →</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
