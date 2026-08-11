'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export default function QuestionEditor({ initialContent, onSave, onCancel }: Props) {
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // 插入标记
  const insertMark = (before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.substring(start, end);
    const newText =
      content.substring(0, start) + before + selected + after + content.substring(end);
    setContent(newText);

    // 恢复光标位置
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selected.length
      );
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave(content);
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="toolbar">
        <button onClick={() => insertMark('**', '**')} title="加粗 (Ctrl+B)">
          <strong>B</strong>
        </button>
        <button onClick={() => insertMark('*', '*')} title="斜体">
          <em>I</em>
        </button>
        <button onClick={() => insertMark('<u>', '</u>')} title="下划线">
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>
        <button onClick={() => insertMark('~~', '~~')} title="删除线">
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </button>

        <span className="separator" />

        <button onClick={() => insertMark('# ', '')} title="一级标题">H1</button>
        <button onClick={() => insertMark('## ', '')} title="二级标题">H2</button>
        <button onClick={() => insertMark('### ', '')} title="三级标题">H3</button>

        <span className="separator" />

        <button onClick={() => insertMark('```\n', '\n```')} title="代码块">&lt;/&gt;</button>
        <button onClick={() => insertMark('`', '`')} title="行内代码">`</button>
        <button onClick={() => insertMark('> ', '')} title="引用">"</button>

        <span className="separator" />

        <button onClick={() => insertMark('- ', '')} title="无序列表">-</button>
        <button onClick={() => insertMark('1. ', '')} title="有序列表">1.</button>
        <button onClick={() => insertMark('[', '](url)')} title="链接">🔗</button>

        <span className="separator" />

        <button
          onClick={() => insertMark('==', '==')}
          title="高亮"
          style={{ background: '#fff3cd' }}
        >
          = =
        </button>

        <span className="separator" />

        <button
          onClick={() => insertMark('<span style="color: #e03131">', '</span>')}
          title="红色文字"
          style={{ color: '#e03131', fontWeight: 'bold' }}
        >
          A
        </button>
        <button
          onClick={() => insertMark('<span style="color: #2f9e44">', '</span>')}
          title="绿色文字"
          style={{ color: '#2f9e44', fontWeight: 'bold' }}
        >
          A
        </button>
        <button
          onClick={() => insertMark('<span style="color: #4c6ef5">', '</span>')}
          title="蓝色文字"
          style={{ color: '#4c6ef5', fontWeight: 'bold' }}
        >
          A
        </button>

        <select
          onChange={(e) => {
            const size = e.target.value;
            if (size) insertMark(`<span style="font-size: ${size}">`, '</span>');
            e.target.value = '';
          }}
          title="字号"
        >
          <option value="">字号</option>
          <option value="0.8em">小</option>
          <option value="1em">正常</option>
          <option value="1.2em">大</option>
          <option value="1.5em">特大</option>
        </select>

        <select
          onChange={(e) => {
            const color = e.target.value;
            if (color) insertMark(`<span style="background: ${color}">`, '</span>');
            e.target.value = '';
          }}
          title="背景色"
        >
          <option value="">背景色</option>
          <option value="#fff3cd">黄色</option>
          <option value="#d3f9d8">绿色</option>
          <option value="#d0ebff">蓝色</option>
          <option value="#ffe3e3">红色</option>
        </select>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        style={{
          width: '100%',
          minHeight: 'calc(100vh - 260px)',
          padding: 16,
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 var(--radius) var(--radius)',
          fontSize: 14,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.7,
          resize: 'vertical',
          outline: 'none',
        }}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="开始编辑 Markdown..."
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => onSave(content)}>
          保存 (Ctrl+S)
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
