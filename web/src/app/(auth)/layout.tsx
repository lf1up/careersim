import type { ReactNode } from 'react';
import type { Metadata } from 'next';

import { Footer } from '@/components/layout/Footer';
import { SITE_NAME } from '@/lib/seo';

// Auth routes read `?next=` / `?token=` via useSearchParams and call
// into useAuth, so they can't be statically prerendered — force dynamic
// rendering for all (auth) pages.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    template: `%s | ${SITE_NAME}`,
    default: 'Account access',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-retro-paper text-retro-ink transition-colors dark:bg-retro-paper-dark dark:text-retro-ink-dark">
      <main className="min-h-0 flex-1">
        {children}
        <Footer />
      </main>
    </div>
  );
}
