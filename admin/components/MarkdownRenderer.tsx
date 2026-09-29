'use client';

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from './MermaidDiagram';

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

function mermaidSource(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const code = children as ReactElement<CodeElementProps>;
  if (!code.props.className?.split(/\s+/).includes('language-mermaid')) return null;
  return String(code.props.children || '').replace(/\n$/, '');
}

const components: Components = {
  pre({ children, ...props }) {
    const chart = mermaidSource(children);
    if (chart !== null) return <MermaidDiagram chart={chart} />;
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
