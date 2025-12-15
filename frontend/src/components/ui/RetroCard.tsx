import React from 'react';
import clsx from 'clsx';

interface RetroCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

export const RetroCard: React.FC<RetroCardProps> = ({
  title,
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
        <div className={clsx('px-6 py-4 border-b-2 border-black dark:border-retro-ink-dark flex items-start justify-between', headerClassName)}>
          <div>
            {title && (
              <h3 className="text-xl font-semibold text-retro-ink dark:text-retro-ink-dark">{title}</h3>
            )}
            {subtitle && (
              <p className="text-sm font-monoRetro mt-1 text-secondary-600 dark:text-secondary-400">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      <div className={clsx('p-6', bodyClassName)}>{children}</div>
    </div>
  );
};

export default RetroCard;
