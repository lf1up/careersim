'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/lib/api';
import type { SessionSummary, Simulation } from '@/lib/types';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroPanel } from '@/components/ui/RetroPanel';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { ValueText } from '@/components/ui/ValueText';

export default function DashboardPage() {
  const { user } = useAuth();
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sims, sess] = await Promise.all([
          apiClient.listSimulations(),
          apiClient.listSessions(),
        ]);
        if (cancelled) return;
        setSimulations(sims);
        setSessions(sess);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load dashboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const totalMessages = sessions.reduce((sum, s) => sum + s.message_count, 0);
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <RetroCard
        title={<span className="font-retro tracking-wider2">WELCOME BACK</span>}
        subtitle={user?.email ?? 'Loading user...'}
      >
        <p className="text-retro-ink dark:text-retro-ink-dark">
          Pick a simulation to start a fresh chat, or continue one of your recent
          sessions.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/simulations">
            <Button variant="primary">Browse simulations</Button>
          </Link>
          <Link href="/sessions">
            <Button variant="outline">My sessions</Button>
          </Link>
        </div>
      </RetroCard>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Available simulations
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={simulations.length} />
          </p>
        </RetroCard>
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Your sessions
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={sessions.length} />
          </p>
        </RetroCard>
        <RetroCard>
          <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 uppercase tracking-wider2">
            Messages exchanged
          </p>
          <p className="text-3xl mt-2">
            <ValueText value={totalMessages} />
          </p>
        </RetroCard>
      </div>

      <RetroPanel
        title="Recent sessions"
        right={
          <Link href="/sessions" className="text-sm underline text-primary-600 dark:text-primary-400">
            View all
          </Link>
        }
      >
        {recentSessions.length === 0 ? (
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No sessions yet. Kick one off from the{' '}
            <Link href="/simulations" className="underline text-primary-600 dark:text-primary-400">
              simulations page
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y-2 divide-black/10 dark:divide-retro-ink-dark/20">
            {recentSessions.map((s) => (
              <li
                key={s.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-retro-ink dark:text-retro-ink-dark truncate">
                    {s.simulation_slug}
                  </p>
                  <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
                    {s.message_count} messages · updated{' '}
                    {new Date(s.updated_at).toLocaleString()}
                  </p>
                </div>
                <Link href={`/sessions/${s.id}`}>
                  <Button variant="outline" size="sm">
                    Open
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RetroPanel>
    </div>
  );
}
