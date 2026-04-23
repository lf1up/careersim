'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';

export const ProfilePage: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-6 pb-12 sm:pb-16 max-w-2xl mx-auto w-full retro-fade-in">
      <AccountSummaryCard />
      <ChangeEmailCard />
      <PasswordCard />
    </div>
  );
};

// ---------------------------------------------------------------------
// Account summary

const AccountSummaryCard: React.FC = () => {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <RetroCard
      title={<span className="font-retro tracking-wider2">ACCOUNT</span>}
      subtitle={
        <span className="text-secondary-600 dark:text-secondary-400">
          Your account identity and status.
        </span>
      }
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
        <div>
          <dt className="font-semibold text-retro-ink dark:text-retro-ink-dark">Email</dt>
          <dd className="font-monoRetro text-retro-ink dark:text-retro-ink-dark">
            {user.email}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-retro-ink dark:text-retro-ink-dark">Status</dt>
          <dd>
            {user.email_verified_at ? (
              <RetroBadge color="green">Verified</RetroBadge>
            ) : (
              <RetroBadge color="yellow">Unverified</RetroBadge>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-retro-ink dark:text-retro-ink-dark">Password</dt>
          <dd>
            {user.has_password ? (
              <RetroBadge color="cyan">Set</RetroBadge>
            ) : (
              <RetroBadge color="orange">Not set</RetroBadge>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-retro-ink dark:text-retro-ink-dark">Member since</dt>
          <dd className="font-monoRetro text-retro-ink dark:text-retro-ink-dark">
            {format(new Date(user.created_at), 'MMM d, yyyy')}
          </dd>
        </div>
      </dl>
    </RetroCard>
  );
};

// ---------------------------------------------------------------------
// Change email

type EmailStep =
  | { kind: 'form' }
  | { kind: 'verify'; newEmail: string };

const ChangeEmailCard: React.FC = () => {
  const { user, requestEmailChange, confirmEmailChange } = useAuth();
  const [step, setStep] = useState<EmailStep>({ kind: 'form' });

  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (!user) return null;

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newEmail.trim().toLowerCase() === user.email.toLowerCase()) {
      setError('That is already your email.');
      return;
    }
    if (user.has_password && !currentPassword) {
      setError('Enter your current password to authorize this change.');
      return;
    }
    setSubmitting(true);
    try {
      await requestEmailChange(
        newEmail.trim(),
        user.has_password ? currentPassword : undefined,
      );
      setStep({ kind: 'verify', newEmail: newEmail.trim() });
      setCurrentPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start email change.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setConfirmError('Enter the 6-digit code we emailed you.');
      return;
    }
    setConfirmSubmitting(true);
    setConfirmError(null);
    try {
      await confirmEmailChange(code);
      setStep({ kind: 'form' });
      setNewEmail('');
      setCode('');
      setSuccess('Email updated.');
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : 'Invalid or expired code.',
      );
    } finally {
      setConfirmSubmitting(false);
    }
  };

  return (
    <RetroCard
      title={<span className="font-retro tracking-wider2">CHANGE EMAIL</span>}
      subtitle={
        <span className="text-secondary-600 dark:text-secondary-400">
          We&apos;ll email a 6-digit code to the new address to confirm you own it.
        </span>
      }
    >
      {step.kind === 'form' ? (
        <form className="space-y-4" onSubmit={handleRequest}>
          <RetroInput
            label="New email address"
            name="newEmail"
            type="email"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          {user.has_password && (
            <RetroInput
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          )}

          {error && (
            <RetroAlert tone="error" title="Couldn't start change">
              {error}
            </RetroAlert>
          )}
          {success && (
            <RetroAlert tone="success" title="Saved">
              {success}
            </RetroAlert>
          )}

          <Button type="submit" isLoading={submitting}>
            Send confirmation code
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleConfirm}>
          <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
            Enter the code we emailed to{' '}
            <span className="font-monoRetro">{step.newEmail}</span>.
          </p>
          <RetroInput
            label="Confirmation code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setConfirmError(null);
            }}
            placeholder="123456"
            className="tracking-[0.5em] text-center"
          />

          {confirmError && (
            <RetroAlert tone="error" title="Couldn't verify code">
              {confirmError}
            </RetroAlert>
          )}

          <div className="flex gap-3">
            <Button type="submit" isLoading={confirmSubmitting}>
              Confirm new email
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep({ kind: 'form' });
                setCode('');
                setConfirmError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </RetroCard>
  );
};

// ---------------------------------------------------------------------
// Password

const PasswordCard: React.FC = () => {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const hasPassword = user.has_password;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (hasPassword && !currentPassword) {
      setError('Enter your current password.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(
        newPassword,
        hasPassword ? currentPassword : undefined,
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RetroCard
      title={
        <span className="font-retro tracking-wider2">
          {hasPassword ? 'CHANGE PASSWORD' : 'SET A PASSWORD'}
        </span>
      }
      subtitle={
        <span className="text-secondary-600 dark:text-secondary-400">
          {hasPassword
            ? 'Rotate your password. You will stay signed in on this device.'
            : 'Your account uses passwordless sign-in. Setting a password is optional — you can still use email links afterwards.'}
        </span>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {hasPassword && (
          <RetroInput
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}
        <RetroInput
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="Minimum 8 characters"
        />
        <RetroInput
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        {error && (
          <RetroAlert tone="error" title="Couldn't update password">
            {error}
          </RetroAlert>
        )}
        {success && (
          <RetroAlert tone="success" title="Saved">
            {success}
          </RetroAlert>
        )}

        <Button type="submit" isLoading={submitting}>
          {hasPassword ? 'Update password' : 'Set password'}
        </Button>
      </form>
    </RetroCard>
  );
};
