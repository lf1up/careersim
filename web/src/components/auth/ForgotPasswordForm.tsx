'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { FormErrorAlert } from '@/components/ui/FormErrorAlert';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { AltchaWidget, type AltchaHandle } from './AltchaWidget';
import { CheckYourInboxCard } from './CheckYourInboxCard';

export const ForgotPasswordForm: React.FC = () => {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [submitting, setSubmitting] = useState(false);
  /** Raw thrown value so {@link FormErrorAlert} can detect `RATE_LIMITED`. */
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const [altcha, setAltcha] = useState<string | null>(null);
  /**
   * Imperative handle — see note in {@link LoginForm}. Required to
   * flip the widget out of `verified` on failure; clearing React state
   * alone leaves the custom element stuck in verified state.
   */
  const altchaRef = useRef<AltchaHandle | null>(null);

  const { forgotPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!altcha) {
      setError(new Error('Please complete the human-check above before continuing.'));
      return;
    }
    setSubmitting(true);
    try {
      await forgotPassword(email, altcha);
      setSent(true);
    } catch (err) {
      setError(err ?? new Error('Could not send reset link'));
      setAltcha(null);
      altchaRef.current?.reset();
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
            // Resending from the inbox screen doesn't have a fresh altcha
            // payload; the server will reject without one when bypass is
            // off. In practice this screen points users back to the
            // forgot-password form for a re-run of the full flow.
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

            <AltchaWidget
              handleRef={altchaRef}
              onVerified={setAltcha}
              onReset={() => setAltcha(null)}
            />

            <FormErrorAlert error={error} fallbackTitle="Couldn't send" />

            <Button
              type="submit"
              className="w-full"
              isLoading={submitting}
              disabled={!altcha}
            >
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
