'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroInput } from '@/components/ui/RetroInput';
import { RetroAlert } from '@/components/ui/RetroBadge';
import { safeNextPath } from '@/lib/safe-next-path';

export const RegisterForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const { register, isLoading, error } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'), '/dashboard');
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setPasswordError('');

    try {
      await register(email, password);
      router.push(nextPath);
    } catch {
      // surfaced via AuthContext.error
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-retro-paper dark:bg-retro-paper-dark p-4 transition-colors">
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
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
                setPasswordError('');
              }}
              error={passwordError || undefined}
            />

            {error && (
              <RetroAlert tone="error" title="Registration failed">
                {error}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={isLoading}>
              Create account
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
};
