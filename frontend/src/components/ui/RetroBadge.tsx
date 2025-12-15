import React from 'react';
import clsx from 'clsx';

export interface RetroBadgeProps {
  children: React.ReactNode;
  color?: 'default' | 'yellow' | 'cyan' | 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'pink' | 'lime' | 'teal' | 'indigo' | 'amber' | 'rose';
  className?: string;
}

const colorMap: Record<NonNullable<RetroBadgeProps['color']>, string> = {
  default: 'border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark text-retro-ink dark:text-retro-ink-dark',
  yellow: 'border-black dark:border-retro-ink-dark bg-yellow-300 dark:bg-yellow-500 text-black',
  cyan: 'border-black dark:border-retro-ink-dark bg-cyan-300 dark:bg-cyan-500 text-black',
  green: 'border-black dark:border-retro-ink-dark bg-green-300 dark:bg-green-500 text-black',
  red: 'border-black dark:border-retro-ink-dark bg-red-300 dark:bg-red-500 text-black dark:text-white',
  blue: 'border-black dark:border-retro-ink-dark bg-blue-300 dark:bg-blue-500 text-black dark:text-white',
  purple: 'border-black dark:border-retro-ink-dark bg-purple-300 dark:bg-purple-500 text-black dark:text-white',
  orange: 'border-black dark:border-retro-ink-dark bg-orange-300 dark:bg-orange-500 text-black',
  pink: 'border-black dark:border-retro-ink-dark bg-pink-300 dark:bg-pink-500 text-black',
  lime: 'border-black dark:border-retro-ink-dark bg-lime-300 dark:bg-lime-500 text-black',
  teal: 'border-black dark:border-retro-ink-dark bg-teal-300 dark:bg-teal-500 text-black',
  indigo: 'border-black dark:border-retro-ink-dark bg-indigo-300 dark:bg-indigo-500 text-black dark:text-white',
  amber: 'border-black dark:border-retro-ink-dark bg-amber-300 dark:bg-amber-500 text-black',
  rose: 'border-black dark:border-retro-ink-dark bg-rose-300 dark:bg-rose-500 text-black dark:text-white',
};

export const RetroBadge: React.FC<RetroBadgeProps> = ({ children, color = 'default', className }) => {
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 text-xs font-semibold border-2 shadow-retro-2 dark:shadow-retro-dark-2', colorMap[color], className)}>
      {children}
    </span>
  );
};

export interface RetroAlertProps {
  title?: string;
  children?: React.ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
  className?: string;
}

const toneMap: Record<NonNullable<RetroAlertProps['tone']>, string> = {
  info: 'bg-cyan-100 dark:bg-cyan-900 border-cyan-400 dark:border-cyan-600 text-cyan-900 dark:text-cyan-100',
  success: 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 text-green-900 dark:text-green-100',
  warning: 'bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600 text-yellow-900 dark:text-yellow-100',
  error: 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100',
};

export const RetroAlert: React.FC<RetroAlertProps> = ({ title, children, tone = 'info', className }) => {
  return (
    <div className={clsx('border-2 border-black dark:border-retro-ink-dark p-4 shadow-retro-4 dark:shadow-retro-dark-4', toneMap[tone], className)}>
      {title && <h4 className="font-semibold mb-1">{title}</h4>}
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
};
