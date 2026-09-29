'use client';

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import MermaidDiagram from './MermaidDiagram';

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

function codeBlockData(children: ReactNode): { language: string; source: string } | null {
  if (!isValidElement(children)) return null;
  const code = children as ReactElement<CodeElementProps>;
  const language = code.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] || 'text';
  return {
    language,
    source: String(code.props.children || '').replace(/\n$/, ''),
  };
}

const components: Components = {
  pre({ children, ...props }) {
    const block = codeBlockData(children);
    if (block?.language === 'mermaid') return <MermaidDiagram chart={block.source} />;
    if (block) return <CodeBlock source={block.source} language={block.language} />;
    return <pre {...props}>{children}</pre>;
  },
  code({ children, ...props }) {
    return <code {...props}>{children}</code>;
  },
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  mark({ children, ...props }) {
    return <mark {...props}>{children}</mark>;
  },
};

interface Props {
  markdown: string;
}

export default function MarkdownRenderer({ markdown }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}
