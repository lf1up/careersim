import React, { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { LoadingSpinner } from './LoadingSpinner.tsx';

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
  const baseClasses = 'retro-btn-base font-semibold disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

  const variantClasses = {
    primary: 'bg-black text-white hover:opacity-90',
    secondary: 'bg-retro.accent text-black hover:brightness-95',
    outline: 'bg-white text-black',
    ghost: 'bg-transparent text-black shadow-none border-transparent',
    danger: 'bg-red-600 text-white hover:opacity-90',
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
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <LoadingSpinner
          size="sm"
          className="mr-2 text-current"
        />
      )}
      {children}
    </button>
  );
};