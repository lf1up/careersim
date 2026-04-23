'use client';

import React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';

interface CheckYourInboxCardProps {
  email: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  onResend?: () => Promise<void>;
  onBack?: () => void;
  backHref?: string;
  resentLabel?: string;
}

export const CheckYourInboxCard: React.FC<CheckYourInboxCardProps> = ({
  email,
  title,
  description,
  onResend,
  onBack,
  backHref = '/login',
  resentLabel = 'Email re-sent',
}) => {
  const [resent, setResent] = React.useState<'idle' | 'sending' | 'sent'>('idle');

  const handleResend = async () => {
    if (!onResend || resent === 'sending') return;
    setResent('sending');
    try {
      await onResend();
      setResent('sent');
    } catch {
      setResent('idle');
    }
  };

  return (
    <RetroCard
      title={title ?? <span className="font-retro tracking-wider2">CHECK YOUR EMAIL</span>}
      subtitle={
        <span className="text-secondary-600 dark:text-secondary-400">
          We sent a message to{' '}
          <span className="font-monoRetro text-retro-ink dark:text-retro-ink-dark">
            {email}
          </span>
        </span>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
          {description ??
            "Open the latest message from us and follow the link inside to continue. If it doesn't arrive within a minute or two, check your spam folder."}
        </p>

        <div className="flex items-center justify-between gap-3">
          {onResend ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleResend}
              isLoading={resent === 'sending'}
              disabled={resent === 'sent'}
            >
              {resent === 'sent' ? resentLabel : 'Resend email'}
            </Button>
          ) : (
            <span />
          )}

          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm underline text-secondary-600 dark:text-secondary-400"
            >
              Use a different email
            </button>
          ) : (
            <Link
              href={backHref}
              className="text-sm underline text-secondary-600 dark:text-secondary-400"
            >
              Back to sign in
            </Link>
          )}
        </div>
      </div>
    </RetroCard>
  );
};
