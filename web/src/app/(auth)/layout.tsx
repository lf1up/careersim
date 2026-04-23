import type { ReactNode } from 'react';

// Auth routes read `?next=` / `?token=` via useSearchParams and call
// into useAuth, so they can't be statically prerendered — force dynamic
// rendering for all (auth) pages.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
