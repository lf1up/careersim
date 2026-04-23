'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert } from '@/components/ui/RetroBadge';
import { CheckYourInboxCard } from './CheckYourInboxCard';

export const ForgotPasswordForm: React.FC = () => {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { forgotPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset link');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
        <div className="w-full max-w-md">
          <CheckYourInboxCard
            email={email}
            title={<span className="font-retro tracking-wider2">RESET LINK SENT</span>}
            description="If an account exists for this address, we just emailed a password reset link. It expires in 30 minutes and can only be used once."
            onResend={async () => {
              await forgotPassword(email);
            }}
            backHref="/login"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">FORGOT PASSWORD</span>}
          subtitle={
            <span className="text-secondary-600 dark:text-secondary-400">
              We&apos;ll email you a link to choose a new one.
            </span>
          }
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <RetroInput
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {error && (
              <RetroAlert tone="error" title="Couldn't send">
                {error}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={submitting}>
              Send reset link
            </Button>

            <div className="text-center text-sm">
              <Link
                href="/login"
                className="underline text-secondary-600 dark:text-secondary-400"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        </RetroCard>
      </div>
    </div>
  );
};
