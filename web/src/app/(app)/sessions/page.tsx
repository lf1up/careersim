'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { SessionSummary } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { Button } from '@/components/ui/Button';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await apiClient.listSessions();
        if (!cancelled) setSessions(rows);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load sessions');
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

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
            MY SESSIONS
          </h1>
          <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
            Every conversation you&apos;ve started with a persona.
          </p>
        </div>
        <Link href="/simulations">
          <Button variant="primary">Start new session</Button>
        </Link>
      </div>

      {sorted.length === 0 ? (
        <RetroCard>
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No sessions yet.{' '}
            <Link href="/simulations" className="underline text-primary-600 dark:text-primary-400">
              Browse simulations
            </Link>{' '}
            to start one.
          </p>
        </RetroCard>
      ) : (
        <div className="space-y-3">
          {sorted.map((s) => (
            <RetroCard key={s.id}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-retro-ink dark:text-retro-ink-dark break-all">
                    {s.simulation_slug}
                  </p>
                  <p className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400 mt-1">
                    {s.message_count} messages · created {formatDate(s.created_at)} ·
                    updated {formatDate(s.updated_at)}
                  </p>
                </div>
                <Link href={`/sessions/${s.id}`}>
                  <Button variant="outline" size="sm">
                    Open
                  </Button>
                </Link>
              </div>
            </RetroCard>
          ))}
        </div>
      )}
    </div>
  );
}
