'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';

import { useAuth } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { GitHubLink } from '@/components/ui/GitHubLink';

// Nav items shown when the user is signed in.
const AUTH_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/simulations', label: 'Simulations' },
  { href: '/sessions', label: 'My Sessions' },
];

// Nav items shown to guests. Keep this to just the public catalogue so
// they don't see dead links pointing at auth-gated pages.
const GUEST_NAV_ITEMS = [{ href: '/simulations', label: 'Simulations' }];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export const Navbar: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // While the auth bootstrap is running we can't know yet which variant of
  // the bar to show; render a minimal neutral header so the page doesn't
  // flash "guest → auth" or vice-versa.
  const navItems = isAuthenticated ? AUTH_NAV_ITEMS : GUEST_NAV_ITEMS;

  const desktopNavLinkClass = (active: boolean) =>
    clsx(
      'px-3 py-2 text-sm font-semibold border-2 border-black dark:border-retro-ink-dark transition-transform',
      active
        ? 'bg-primary-300 dark:bg-primary-600 text-black dark:text-white translate-x-[1px] translate-y-[1px] shadow-retro-1 dark:shadow-retro-dark-1'
        : 'bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1',
    );

  const mobileNavLinkClass = (active: boolean) =>
    clsx(
      'block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark mx-2',
      active
        ? 'bg-primary-300 dark:bg-primary-600 text-black dark:text-white shadow-retro-1 dark:shadow-retro-dark-1'
        : 'bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2',
    );

  const authButtonClass =
    'px-3 py-2 text-sm font-semibold border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 transition-[transform,box-shadow] duration-150 ease-out hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1 active:translate-x-[2px] active:translate-y-[2px] active:shadow-retro-1 dark:active:shadow-retro-dark-1';

  const homeHref = isAuthenticated ? '/dashboard' : '/simulations';

  return (
    <nav className="bg-retro-paper dark:bg-retro-paper-dark border-b-2 border-black dark:border-retro-ink-dark shadow-retro-y-4 dark:shadow-retro-dark-y-4 relative z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Link
                href={homeHref}
                className="text-xl font-bold tracking-wider2 font-retro text-retro-ink dark:text-retro-ink-dark"
              >
                CAREERSIM.ai
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8 sm:items-center">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={desktopNavLinkClass(isActive(pathname, item.href))}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="hidden sm:flex sm:items-center">
            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <>
                  <span className="text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark">
                    {user?.email}
                  </span>
                  <GitHubLink />
                  <ThemeToggle />
                  <button
                    onClick={handleLogout}
                    className={clsx(
                      authButtonClass,
                      'bg-white dark:bg-retro-surface-dark text-retro-ink dark:text-retro-ink-dark',
                    )}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <GitHubLink />
                  <ThemeToggle />
                  {!isLoading && (
                    <>
                      <Link
                        href="/login"
                        className={clsx(
                          authButtonClass,
                          'bg-white dark:bg-retro-surface-dark text-retro-ink dark:text-retro-ink-dark',
                        )}
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/register"
                        className={clsx(
                          authButtonClass,
                          'bg-primary-300 dark:bg-primary-600 text-black dark:text-white',
                        )}
                      >
                        Sign up
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="sm:hidden flex items-center space-x-2">
            <GitHubLink />
            <ThemeToggle />
            <button
              onClick={() => setIsMobileMenuOpen((v) => !v)}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-menu"
              className="inline-flex items-center justify-center p-2 border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 transition-[transform,box-shadow] duration-150 ease-out hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1 active:translate-x-[2px] active:translate-y-[2px] active:shadow-retro-1 dark:active:shadow-retro-dark-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-retro-ink-dark focus-visible:ring-offset-2"
            >
              <svg
                className="h-6 w-6 text-retro-ink dark:text-retro-ink-dark"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={
                    isMobileMenuOpen
                      ? 'M6 18L18 6M6 6l12 12'
                      : 'M4 6h16M4 12h16M4 18h16'
                  }
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div id="mobile-menu" className="sm:hidden relative z-50">
          <div className="pt-2 pb-3 space-y-1 bg-retro-paper dark:bg-retro-paper-dark border-t-2 border-black dark:border-retro-ink-dark">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={mobileNavLinkClass(isActive(pathname, item.href))}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="border-t-2 border-black dark:border-retro-ink-dark mt-2 pt-2 space-y-1">
              {isAuthenticated ? (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="block w-full text-left px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 mx-2 text-retro-ink dark:text-retro-ink-dark transition-[transform,box-shadow] duration-150 ease-out hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-retro-1 dark:hover:shadow-retro-dark-1 active:translate-x-[2px] active:translate-y-[2px] active:shadow-retro-1 dark:active:shadow-retro-dark-1"
                >
                  Sign out
                </button>
              ) : !isLoading ? (
                <>
                  <Link
                    href="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark mx-2 bg-white dark:bg-retro-surface-dark shadow-retro-2 dark:shadow-retro-dark-2 text-retro-ink dark:text-retro-ink-dark"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block px-3 py-2 text-base font-semibold border-2 border-black dark:border-retro-ink-dark mx-2 bg-primary-300 dark:bg-primary-600 text-black dark:text-white shadow-retro-2 dark:shadow-retro-dark-2"
                  >
                    Sign up
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};
