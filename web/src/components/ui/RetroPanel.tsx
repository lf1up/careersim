import React from 'react';
import clsx from 'clsx';

interface RetroPanelProps {
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const RetroPanel: React.FC<RetroPanelProps> = ({
  title,
  right,
  className,
  children,
}) => {
  return (
    <section className={clsx('retro-card', className)}>
      <header className="px-6 py-4 border-b-2 border-black dark:border-retro-ink-dark flex items-center justify-between">
        <h2 className="text-xl font-semibold text-retro-ink dark:text-retro-ink-dark">
          {title}
        </h2>
        {right}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
};

export default RetroPanel;
