'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert } from '@/components/ui/RetroBadge';

export const ResetPasswordForm: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setPasswordError(null);

    setSubmitting(true);
    try {
      await resetPassword(token, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
        <div className="w-full max-w-md">
          <RetroCard
            title={
              <span className="font-retro tracking-wider2">LINK INVALID</span>
            }
            subtitle={
              <span className="text-secondary-600 dark:text-secondary-400">
                This reset link is missing or malformed.
              </span>
            }
          >
            <RetroAlert tone="error" title="Missing token">
              Try requesting a fresh reset email from the forgot-password page.
            </RetroAlert>
            <div className="flex gap-3 mt-4">
              <Link href="/forgot-password" className="flex-1">
                <Button className="w-full">Request new link</Button>
              </Link>
              <Link href="/login" className="flex-1">
                <Button variant="outline" className="w-full">
                  Back to sign in
                </Button>
              </Link>
            </div>
          </RetroCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
      <div className="w-full max-w-md">
        <RetroCard
          title={<span className="font-retro tracking-wider2">SET A NEW PASSWORD</span>}
          subtitle={
            <span className="text-secondary-600 dark:text-secondary-400">
              Choose a new password to finish the reset. You&apos;ll be signed
              in automatically.
            </span>
          }
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <RetroInput
              label="New password"
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
              label="Confirm new password"
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

            {error && (
              <RetroAlert tone="error" title="Couldn't reset password">
                {error}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={submitting}>
              Update password
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
};
