'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroAlert } from '@/components/ui/RetroBadge';

type Status =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export const MagicLinkCallback: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const nextRaw = searchParams.get('next');

  const { consumeMagicLink } = useAuth();
  const [status, setStatus] = useState<Status>(
    token ? { kind: 'loading' } : { kind: 'error', message: 'Missing token.' },
  );
  // StrictMode fires effects twice in dev; the backend marks tokens
  // consumed on first hit, so a second call would fail with INVALID_TOKEN.
  const calledRef = useRef(false);

  useEffect(() => {
    if (!token || calledRef.current) return;
    calledRef.current = true;

    void (async () => {
      try {
        await consumeMagicLink(token);
        setStatus({ kind: 'success' });
        const dest = nextRaw && nextRaw.startsWith('/') ? nextRaw : '/dashboard';
        // Tiny delay so the user sees the success state.
        setTimeout(() => router.replace(dest), 400);
      } catch (err) {
        setStatus({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'This sign-in link is invalid or expired.',
        });
      }
    })();
  }, [token, consumeMagicLink, router, nextRaw]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">SIGNING YOU IN</span>}
        >
          {status.kind === 'loading' && (
            <div className="flex items-center gap-3 text-sm font-monoRetro text-retro-ink dark:text-retro-ink-dark">
              <LoadingSpinner size="sm" />
              <span>Exchanging your link for a session…</span>
            </div>
          )}

          {status.kind === 'success' && (
            <div className="space-y-3">
              <RetroAlert tone="success" title="Signed in">
                Redirecting you to the app…
              </RetroAlert>
            </div>
          )}

          {status.kind === 'error' && (
            <div className="space-y-4">
              <RetroAlert tone="error" title="Can't sign you in">
                {status.message}
              </RetroAlert>
              <div className="flex gap-3">
                <Link href="/login" className="flex-1">
                  <Button className="w-full">Back to sign in</Button>
                </Link>
                <Link href="/register" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Create an account
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </RetroCard>
      </div>
    </div>
  );
};
