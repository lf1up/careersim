import React, { type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

import { LoadingSpinner } from './LoadingSpinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className,
  children,
  ...props
}) => {
  const baseClasses =
    'retro-btn-base font-semibold disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2';

  const variantClasses = {
    primary:
      'bg-black dark:bg-retro-ink-dark text-white dark:text-retro-paper-dark hover:opacity-90',
    secondary:
      'bg-retro-accent dark:bg-retro-accent-dark text-black hover:brightness-95',
    outline:
      'bg-white dark:bg-retro-surface-dark text-black dark:text-retro-ink-dark',
    // `ghost` sits inside `retro-btn-base`, which applies a retro drop-shadow
    // + press animation to every button. For a flat text-button look we have
    // to cancel those with `!` overrides and replace the motion with a
    // hover background tint. `retro.muted` (gray-200) sits clearly above the
    // cream `retro.paper` page background; `retro.muted-dark` does the same
    // in dark mode. `text-retro-ink` matches the palette's warm slate-900
    // instead of pure `#000`.
    ghost:
      'bg-transparent text-retro-ink dark:text-retro-ink-dark border-transparent !shadow-none enabled:hover:bg-retro-muted dark:enabled:hover:bg-retro-muted-dark enabled:hover:!translate-x-0 enabled:hover:!translate-y-0 active:!translate-x-0 active:!translate-y-0',
    danger: 'bg-red-600 dark:bg-red-500 text-white hover:opacity-90',
  } as const;

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs tracking-wider2',
    md: 'px-4 py-2 text-sm tracking-wider2',
    lg: 'px-6 py-3 text-base tracking-wider2',
  } as const;

  return (
    <button
      className={clsx(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <LoadingSpinner size="sm" className="mr-2 text-current" />}
      {children}
    </button>
  );
};
