import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

// Lightweight, safe markdown renderer with fenced code blocks
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            const language = /language-([\w-]+)/.exec(className || '')?.[1];
            if (inline) {
              return (
                <code className="px-1 py-0.5 bg-gray-100 rounded text-secondary-800" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="bg-white overflow-x-auto p-3" {...props}>
                <code className={language ? `language-${language}` : undefined}>
                  {children}
                </code>
              </pre>
            );
          },
          p({ children }) {
            return <p className="whitespace-pre-wrap break-words">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-6">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-6">{children}</ol>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMessage;


