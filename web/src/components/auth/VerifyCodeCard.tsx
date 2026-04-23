'use client';

import React, { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FormErrorAlert } from '@/components/ui/FormErrorAlert';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';

interface VerifyCodeCardProps {
  email: string;
  /** Called with the submitted 6-digit code. Throw to surface an error. */
  onSubmit: (code: string) => Promise<void>;
  /** Called when the user clicks the "resend code" link. */
  onResend?: () => Promise<void>;
  /** Called when the user wants to go back to the previous step. */
  onBack?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  submitLabel?: string;
}

export const VerifyCodeCard: React.FC<VerifyCodeCardProps> = ({
  email,
  onSubmit,
  onResend,
  onBack,
  title,
  subtitle,
  submitLabel = 'Confirm code',
}) => {
  const [code, setCode] = useState('');
  /** Raw thrown value so {@link FormErrorAlert} can detect `RATE_LIMITED`. */
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent'>('idle');

  const sanitize = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError(new Error('Enter the 6-digit code we emailed you.'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err) {
      setError(err ?? new Error('Invalid or expired code.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!onResend || resent === 'sending') return;
    setResent('sending');
    // Share the main error slot — a resend failure (typically the
    // 3/hour per-mailbox rate limit) is strictly more informative
    // than the old silent swallow that just flipped state back to
    // `idle`, and the submit/resend errors are mutually exclusive
    // from the user's point of view.
    setError(null);
    try {
      await onResend();
      setResent('sent');
      setTimeout(() => setResent('idle'), 4000);
    } catch (err) {
      setResent('idle');
      setError(err ?? new Error('Could not resend code — please try again.'));
    }
  };

  return (
    <RetroCard
      title={
        title ?? <span className="font-retro tracking-wider2">CHECK YOUR EMAIL</span>
      }
      subtitle={
        subtitle ?? (
          <span className="text-secondary-600 dark:text-secondary-400">
            We sent a 6-digit code to{' '}
            <span className="font-monoRetro text-retro-ink dark:text-retro-ink-dark">
              {email}
            </span>
          </span>
        )
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <RetroInput
          label="Confirmation code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          required
          value={code}
          onChange={(e) => {
            setCode(sanitize(e.target.value));
            setError(null);
          }}
          maxLength={6}
          placeholder="123456"
          className="tracking-[0.5em] text-center"
          hint="The code expires in 10 minutes."
        />

        <FormErrorAlert error={error} fallbackTitle="Couldn't verify code" />

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {submitLabel}
        </Button>

        <div className="flex items-center justify-between text-sm">
          {onResend ? (
            <button
              type="button"
              onClick={handleResend}
              disabled={resent !== 'idle'}
              className="underline text-primary-600 dark:text-primary-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {resent === 'idle' && 'Resend code'}
              {resent === 'sending' && 'Sending…'}
              {resent === 'sent' && 'Code re-sent'}
            </button>
          ) : (
            <span />
          )}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="underline text-secondary-600 dark:text-secondary-400"
            >
              Use a different email
            </button>
          )}
        </div>
      </form>
    </RetroCard>
  );
};
