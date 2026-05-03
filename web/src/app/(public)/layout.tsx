import type { ReactNode } from 'react';

import { Footer } from '@/components/layout/Footer';
import { Navbar } from '@/components/layout/Navbar';

// Public shell: same layout as `(app)` but WITHOUT the `RequireAuth`
// guard. Guests can browse `/simulations` and `/simulations/[slug]`
// without signing in; any write actions surfaced on these pages must
// handle the unauthenticated case themselves (redirect to login).
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-retro-paper dark:bg-retro-paper-dark transition-colors">
      <Navbar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:px-8 lg:py-6 max-w-7xl mx-auto w-full h-full">
          {children}
          <Footer />
        </div>
      </main>
    </div>
  );
}
