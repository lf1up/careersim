import type { ReactNode } from 'react';

import { Navbar } from '@/components/layout/Navbar';
import { RequireAuth } from '@/components/auth/RequireAuth';

// All (app) routes are auth-gated and rely on client-side context
// (useAuth, useSearchParams in RequireAuth). Skip static prerendering
// so Next.js doesn't try to evaluate client-only hooks at build time.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: ReactNode }) {
  // Shell is a flex column pinned to the viewport so pages that want to
  // stretch to full height (e.g. the chat transcript on /sessions/:id)
  // can set `h-full` on their root and let an internal scroll container
  // absorb overflow. Pages that don't need that (dashboard, lists) still
  // render naturally — `<main>` scrolls when their content exceeds the
  // remaining height.
  return (
    <RequireAuth>
      <div className="h-screen flex flex-col bg-retro-paper dark:bg-retro-paper-dark transition-colors">
        <Navbar />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}
