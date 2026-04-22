import React from 'react';
import clsx from 'clsx';

interface RetroPanelProps {
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  /** Extra classes applied to the panel body wrapper (e.g. `flex-1 min-h-0`). */
  bodyClassName?: string;
  children?: React.ReactNode;
}

export const RetroPanel: React.FC<RetroPanelProps> = ({
  title,
  right,
  className,
  bodyClassName,
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
      <div className={clsx('p-6', bodyClassName)}>{children}</div>
    </section>
  );
};

export default RetroPanel;
