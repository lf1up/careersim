import type { ReactNode } from 'react';
import type { Metadata } from 'next';

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
  return <>{children}</>;
}
