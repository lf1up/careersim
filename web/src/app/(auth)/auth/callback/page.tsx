import { Suspense } from 'react';

import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { MagicLinkCallback } from '@/components/auth/MagicLinkCallback';

export const metadata = {
  title: 'Signing in',
};

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <MagicLinkCallback />
    </Suspense>
  );
}
