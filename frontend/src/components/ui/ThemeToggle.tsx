import React from 'react';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`
        inline-flex items-center justify-center
        w-10 h-10
        border-2 border-black dark:border-retro-ink-dark
        bg-white dark:bg-retro-surface-dark
        shadow-retro-2 dark:shadow-retro-dark-2
        transition-transform
        active:translate-x-[1px] active:translate-y-[1px]
        active:shadow-retro-1 dark:active:shadow-retro-dark-1
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2
        ${className}
      `}
      aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {resolvedTheme === 'dark' ? (
        <SunIcon className="h-5 w-5 text-retro-accent-dark" />
      ) : (
        <MoonIcon className="h-5 w-5 text-retro-ink" />
      )}
    </button>
  );
};

