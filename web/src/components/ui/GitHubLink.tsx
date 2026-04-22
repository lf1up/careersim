'use client';

import React from 'react';

// Public repository for the project. Kept inline here rather than in an
// env var because it's not a secret and having it hardcoded means the
// link keeps working in every environment (local, preview, prod).
export const GITHUB_REPO_URL = 'https://github.com/lf1up/careersim';

interface GitHubLinkProps {
  className?: string;
}

/**
 * Square icon-only link to the project's GitHub repo. Matches the retro
 * press-in interaction of `ThemeToggle` so they sit next to each other
 * cleanly in the navbar.
 */
export const GitHubLink: React.FC<GitHubLinkProps> = ({ className = '' }) => {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View source on GitHub"
      title="View source on GitHub"
      className={`
        inline-flex items-center justify-center
        w-10 h-10
        border-2 border-black dark:border-retro-ink-dark
        bg-white dark:bg-retro-surface-dark
        shadow-retro-2 dark:shadow-retro-dark-2
        transition-[transform,box-shadow] duration-150 ease-out
        hover:translate-x-[1px] hover:translate-y-[1px]
        hover:shadow-retro-1 dark:hover:shadow-retro-dark-1
        active:translate-x-[2px] active:translate-y-[2px]
        active:shadow-retro-1 dark:active:shadow-retro-dark-1
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2
        ${className}
      `}
    >
      {/* Octicons `mark-github` (MIT) — single path keeps the SVG light. */}
      <svg
        className="h-5 w-5 text-retro-ink dark:text-retro-ink-dark"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
        />
      </svg>
    </a>
  );
};

export default GitHubLink;
