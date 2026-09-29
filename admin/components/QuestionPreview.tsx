'use client';

import MarkdownRenderer from './MarkdownRenderer';

interface Props {
  markdown: string;
}

export default function QuestionPreview({ markdown }: Props) {
  return (
    <div className="card">
      <div className="markdown-preview">
        <MarkdownRenderer markdown={markdown} />
      </div>
    </div>
  );
}
