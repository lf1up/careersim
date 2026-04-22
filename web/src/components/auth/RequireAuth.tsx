'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // Preserve where the user was heading so they get bounced back
      // there after signing in (see `LoginForm` / `RegisterForm`).
      const qs = searchParams.toString();
      const next = qs ? `${pathname}?${qs}` : pathname;
      const target =
        next && next !== '/'
          ? `/login?next=${encodeURIComponent(next)}`
          : '/login';
      router.replace(target);
    }
  }, [isAuthenticated, isLoading, router, pathname, searchParams]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
};
