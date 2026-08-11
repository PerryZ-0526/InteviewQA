'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface Props {
  markdown: string;
}

export default function QuestionPreview({ markdown }: Props) {
  return (
    <div className="card">
      <div className="markdown-preview">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            // 代码块渲染
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !String(children).includes('\n');
              if (isInline) {
                return <code {...props}>{children}</code>;
              }
              return (
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            },
            // 表格中的链接用新标签打开
            a({ href, children, ...props }) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            },
            // 高亮显示
            mark({ children, ...props }) {
              return <mark {...props}>{children}</mark>;
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
