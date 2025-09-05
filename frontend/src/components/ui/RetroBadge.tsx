import React from 'react';
import clsx from 'clsx';

export interface RetroBadgeProps {
  children: React.ReactNode;
  color?: 'default' | 'yellow' | 'cyan' | 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'pink' | 'lime' | 'teal' | 'indigo' | 'amber' | 'rose';
  className?: string;
}

const colorMap: Record<NonNullable<RetroBadgeProps['color']>, string> = {
  default: 'border-black bg-white',
  yellow: 'border-black bg-yellow-300',
  cyan: 'border-black bg-cyan-300',
  green: 'border-black bg-green-300',
  red: 'border-black bg-red-300',
  blue: 'border-black bg-blue-300',
  purple: 'border-black bg-purple-300',
  orange: 'border-black bg-orange-300',
  pink: 'border-black bg-pink-300',
  lime: 'border-black bg-lime-300',
  teal: 'border-black bg-teal-300',
  indigo: 'border-black bg-indigo-300',
  amber: 'border-black bg-amber-300',
  rose: 'border-black bg-rose-300',
};

export const RetroBadge: React.FC<RetroBadgeProps> = ({ children, color = 'default', className }) => {
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 text-xs font-semibold border-2 shadow-[2px_2px_0_#111827]', colorMap[color], className)}>
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
  info: 'bg-cyan-100 border-cyan-400',
  success: 'bg-green-100 border-green-400',
  warning: 'bg-yellow-100 border-yellow-400',
  error: 'bg-red-100 border-red-400',
};

export const RetroAlert: React.FC<RetroAlertProps> = ({ title, children, tone = 'info', className }) => {
  return (
    <div className={clsx('border-2 border-black p-4 shadow-[4px_4px_0_#111827]', toneMap[tone], className)}>
      {title && <h4 className="font-semibold mb-1">{title}</h4>}
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
};
