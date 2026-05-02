'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { FormErrorAlert } from '@/components/ui/FormErrorAlert';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { safeNextPath } from '@/lib/safe-next-path';
import { AltchaWidget, type AltchaHandle } from './AltchaWidget';
import { VerifyCodeCard } from './VerifyCodeCard';

type Mode = 'email-link' | 'password';

type Step =
  | { kind: 'form' }
  | { kind: 'verify'; email: string };

export const RegisterForm: React.FC = () => {
  const [mode, setMode] = useState<Mode>('email-link');
  const [step, setStep] = useState<Step>({ kind: 'form' });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /** Raw thrown value so {@link FormErrorAlert} can detect `RATE_LIMITED`. */
  const [formError, setFormError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [altcha, setAltcha] = useState<string | null>(null);
  /**
   * Imperative handle — see note in {@link LoginForm}. Required to
   * flip the widget out of `verified` on failure; clearing React state
   * alone leaves the custom element happily reporting verified forever.
   */
  const altchaRef = useRef<AltchaHandle | null>(null);

  const { register, verifyEmail, resendVerification } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'), '/dashboard');
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (mode === 'password') {
      if (password !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return;
      }
      if (password.length < 8) {
        setPasswordError('Password must be at least 8 characters');
        return;
      }
      setPasswordError(null);
    }

    if (!altcha) {
      setFormError(new Error('Please complete the human-check above before continuing.'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { email: pendingEmail } = await register(
        email,
        mode === 'password' ? password : undefined,
        altcha,
      );
      setStep({ kind: 'verify', email: pendingEmail });
    } catch (err) {
      setFormError(err ?? new Error('Registration failed'));
      // Altcha payloads are single-use; reset so the user can re-verify.
      setAltcha(null);
      altchaRef.current?.reset();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (code: string) => {
    if (step.kind !== 'verify') return;
    await verifyEmail(step.email, code);
    router.push(nextPath);
  };

  const handleResend = async () => {
    if (step.kind !== 'verify') return;
    await resendVerification(step.email);
  };

  if (step.kind === 'verify') {
    return (
      <div className="min-h-full flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
        <div className="w-full max-w-md">
          <VerifyCodeCard
            email={step.email}
            onSubmit={handleVerify}
            onResend={handleResend}
            onBack={() => setStep({ kind: 'form' })}
            submitLabel="Finish signup"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">CREATE ACCOUNT</span>}
          subtitle={
            <span className="text-secondary-600 dark:text-secondary-400">
              Already a member?{' '}
              <Link href={loginHref} className="underline text-primary-600 dark:text-primary-400">
                sign in
              </Link>
            </span>
          }
        >
          <div
            role="tablist"
            aria-label="Registration method"
            className="grid grid-cols-2 gap-0 border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 mb-5"
          >
            <TabButton
              active={mode === 'email-link'}
              onClick={() => setMode('email-link')}
            >
              Email link
            </TabButton>
            <TabButton
              active={mode === 'password'}
              onClick={() => setMode('password')}
            >
              With password
            </TabButton>
          </div>

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

            {mode === 'password' && (
              <>
                <RetroInput
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  hint="Minimum 8 characters"
                />
                <RetroInput
                  label="Confirm password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  error={passwordError || undefined}
                />
              </>
            )}

            {mode === 'email-link' && (
              <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                We&apos;ll email you a 6-digit code to finish creating your account.
                You can set a password later from your profile settings.
              </p>
            )}

            <AltchaWidget
              handleRef={altchaRef}
              onVerified={setAltcha}
              onReset={() => setAltcha(null)}
            />

            <FormErrorAlert error={formError} fallbackTitle="Registration failed" />

            <Button
              type="submit"
              className="w-full"
              isLoading={isSubmitting}
              disabled={!altcha}
            >
              {mode === 'password' ? 'Create account' : 'Email me a code'}
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
};

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={clsx(
      'px-3 py-2 text-sm font-semibold tracking-wider2 border-black dark:border-retro-ink-dark',
      'first:border-r-2 transition-colors',
      active
        ? 'bg-primary-300 dark:bg-primary-600 text-black dark:text-white'
        : 'bg-white dark:bg-retro-surface-dark text-retro-ink dark:text-retro-ink-dark hover:bg-retro-muted dark:hover:bg-retro-muted-dark',
    )}
  >
    {children}
  </button>
);
