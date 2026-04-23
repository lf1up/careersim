'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert } from '@/components/ui/RetroBadge';
import { ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/safe-next-path';
import { AltchaWidget } from './AltchaWidget';
import { CheckYourInboxCard } from './CheckYourInboxCard';
import { VerifyCodeCard } from './VerifyCodeCard';

type Step =
  | { kind: 'form' }
  | { kind: 'verify-after-unverified'; email: string }
  | { kind: 'email-link-sent'; email: string };

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [altcha, setAltcha] = useState<string | null>(null);

  const {
    login,
    verifyEmail,
    resendVerification,
    requestEmailLink,
    isLoading,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'), '/dashboard');
  const registerHref = `/register?next=${encodeURIComponent(nextPath)}`;
  const forgotHref = `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!altcha) {
      setFormError('Please complete the human-check above before continuing.');
      return;
    }
    try {
      await login(email, password, altcha);
      router.push(nextPath);
    } catch (err) {
      // The altcha payload is single-use on the server; drop it so the
      // widget re-verifies before the next submit.
      setAltcha(null);
      // Special-case a couple of known errors so the UI can nudge the user
      // into the right flow rather than dead-ending.
      if (err instanceof ApiError) {
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          // Re-trigger a fresh code so the user has one in their inbox.
          // The previous email-link endpoint is the abuse-prone one; resend
          // doesn't need a second captcha because the server gates it by
          // pending-verification state.
          await resendVerification(email).catch(() => {
            /* swallow — we're already pivoting the UI */
          });
          setStep({ kind: 'verify-after-unverified', email });
          return;
        }
        if (err.code === 'PASSWORDLESS_ACCOUNT') {
          setFormError(
            'This account has no password yet. Use the "Email me a sign-in link" button below, then set a password from your profile.',
          );
          return;
        }
      }
      setFormError(err instanceof Error ? err.message : 'Invalid email or password');
    }
  };

  const handleEmailLink = async () => {
    setFormError(null);
    if (!email) {
      setFormError('Enter your email first.');
      return;
    }
    if (!altcha) {
      setFormError('Please complete the human-check above before continuing.');
      return;
    }
    setLinkSubmitting(true);
    try {
      await requestEmailLink(email, altcha);
      setStep({ kind: 'email-link-sent', email });
    } catch (err) {
      setAltcha(null);
      setFormError(err instanceof Error ? err.message : 'Could not send email');
    } finally {
      setLinkSubmitting(false);
    }
  };

  const handleVerify = async (code: string) => {
    if (step.kind !== 'verify-after-unverified') return;
    await verifyEmail(step.email, code);
    router.push(nextPath);
  };

  if (step.kind === 'verify-after-unverified') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
        <div className="w-full max-w-md">
          <VerifyCodeCard
            email={step.email}
            onSubmit={handleVerify}
            onResend={() => resendVerification(step.email)}
            onBack={() => setStep({ kind: 'form' })}
            title={<span className="font-retro tracking-wider2">CONFIRM YOUR EMAIL</span>}
            subtitle={
              <span className="text-secondary-600 dark:text-secondary-400">
                Your account still needs to be verified. We sent a fresh 6-digit
                code to{' '}
                <span className="font-monoRetro text-retro-ink dark:text-retro-ink-dark">
                  {step.email}
                </span>
              </span>
            }
            submitLabel="Confirm and sign in"
          />
        </div>
      </div>
    );
  }

  if (step.kind === 'email-link-sent') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
        <div className="w-full max-w-md">
          <CheckYourInboxCard
            email={step.email}
            onResend={() => requestEmailLink(step.email)}
            onBack={() => setStep({ kind: 'form' })}
            description="Open the sign-in link we just emailed you. It expires in 60 minutes and can only be used once."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">SIGN IN</span>}
          subtitle={
            <span className="text-secondary-600 dark:text-secondary-400">
              New to careersim.ai?{' '}
              <Link
                href={registerHref}
                className="underline text-primary-600 dark:text-primary-400"
              >
                create an account
              </Link>
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
            <RetroInput
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex justify-end -mt-2">
              <Link
                href={forgotHref}
                className="text-xs underline text-secondary-600 dark:text-secondary-400"
              >
                Forgot password?
              </Link>
            </div>

            <AltchaWidget
              onVerified={setAltcha}
              onReset={() => setAltcha(null)}
            />

            {formError && (
              <RetroAlert tone="error" title="Sign in failed">
                {formError}
              </RetroAlert>
            )}

            <Button
              type="submit"
              className="w-full"
              isLoading={isLoading}
              disabled={!altcha}
            >
              Sign in
            </Button>
          </form>

          <div className="flex items-center gap-3 my-5 text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
            <span className="flex-1 border-t-2 border-black/10 dark:border-retro-ink-dark/20" />
            <span>or</span>
            <span className="flex-1 border-t-2 border-black/10 dark:border-retro-ink-dark/20" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleEmailLink}
            isLoading={linkSubmitting}
            disabled={!altcha}
          >
            Email me a sign-in link
          </Button>
          <p className="text-xs mt-2 font-monoRetro text-secondary-600 dark:text-secondary-400">
            No password needed — we&apos;ll send a single-use link to your inbox.
          </p>
        </RetroCard>
      </div>
    </div>
  );
};
