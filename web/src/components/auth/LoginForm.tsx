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

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Honor a `next=` query param so guests deep-linking from a public
  // page (e.g. `/simulations/[slug]`) land back on that page after auth.
  const nextPath = safeNextPath(searchParams.get('next'), '/dashboard');
  const registerHref = `/register?next=${encodeURIComponent(nextPath)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      router.push(nextPath);
    } catch {
      // surfaced via AuthContext.error
    }
  };

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

            {error && (
              <RetroAlert tone="error" title="Sign in failed">
                {error}
              </RetroAlert>
            )}

            <Button type="submit" className="w-full" isLoading={isLoading}>
              Sign in
            </Button>
          </form>
        </RetroCard>
      </div>
    </div>
  );
};
