import React from 'react';
import clsx from 'clsx';

interface RetroCardProps {
  title?: React.ReactNode;
  /**
   * Heading level to render the title as. Visual styling is identical
   * regardless of the level — this only changes the underlying tag so
   * callers can promote the card title to a page-level h1 (or h2) when
   * the card represents the primary content of the page.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4';
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

export const RetroCard: React.FC<RetroCardProps> = ({
  title,
  titleAs: TitleTag = 'h3',
  subtitle,
  actions,
  className,
  headerClassName,
  bodyClassName,
  children,
}) => {
  return (
    <div className={clsx('retro-card', className)}>
      {(title || subtitle || actions) && (
        <div
          className={clsx(
            'px-6 py-4 border-b-2 border-black dark:border-retro-ink-dark flex items-start justify-between',
            headerClassName,
          )}
        >
          <div>
            {title && (
              <TitleTag className="text-xl font-semibold text-retro-ink dark:text-retro-ink-dark">
                {title}
              </TitleTag>
            )}
            {subtitle && (
              <div className="text-sm font-monoRetro mt-1 text-secondary-600 dark:text-secondary-400">
                {subtitle}
              </div>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx('p-6', bodyClassName)}>{children}</div>
    </div>
  );
};

export default RetroCard;
