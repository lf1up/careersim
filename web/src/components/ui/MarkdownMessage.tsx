import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <div className="text-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v9 removed the `inline` prop from `code`. Fenced
          // code blocks get a `language-*` class from remark; inline code
          // spans don't. We use that to pick styling, and let the default
          // block rendering place the <code> inside a <pre> (handled below).
          code({ className, children, ...rest }) {
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
            if (language) {
              return (
                <code className={`language-${language}`} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1 py-0.5 bg-gray-100 dark:bg-neutral-700 rounded text-secondary-800 dark:text-secondary-200"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre({ children, ...rest }) {
            return (
              <pre
                className="bg-gray-100 dark:bg-neutral-800 overflow-x-auto p-3 my-2 rounded"
                {...rest}
              >
                {children}
              </pre>
            );
          },
          p({ children }) {
            return <p className="whitespace-pre-wrap break-words">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-6 my-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-6 my-2">{children}</ol>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownMessage;
