import type { ReactNode } from 'react';

import { Navbar } from '@/components/layout/Navbar';
import { RequireAuth } from '@/components/auth/RequireAuth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-retro-paper dark:bg-retro-paper-dark transition-colors">
        <Navbar />
        <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </RequireAuth>
  );
}
