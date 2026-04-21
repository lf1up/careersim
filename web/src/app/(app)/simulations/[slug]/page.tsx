'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

import { apiClient, ApiError } from '@/lib/api';
import type { Simulation } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroAlert } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';

export default function SimulationDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();

  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against double-starting under React strict mode.
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const sims = await apiClient.listSimulations();
        if (cancelled) return;
        const match = sims.find((s) => s.slug === slug);
        if (!match) {
          setError(`Simulation "${slug}" was not found.`);
        } else {
          setSimulation(match);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load simulation';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleStart = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const session = await apiClient.createSession(slug);
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to start session';
      toast.error(message);
      startingRef.current = false;
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !simulation) {
    return (
      <div className="space-y-4">
        <RetroAlert tone="error" title="Simulation unavailable">
          {error ?? 'Unknown error'}
        </RetroAlert>
        <Link href="/simulations">
          <Button variant="outline">Back to simulations</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <RetroCard
        title={simulation.title}
        subtitle={
          <span className="font-monoRetro">
            {simulation.slug} · {simulation.persona_name}
          </span>
        }
      >
        <p className="text-retro-ink dark:text-retro-ink-dark">
          Start a fresh conversation with{' '}
          <span className="font-semibold">{simulation.persona_name}</span>. The
          persona may open the conversation — their first message will appear
          as soon as the session is created.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            variant="primary"
            isLoading={starting}
            onClick={handleStart}
          >
            Start session
          </Button>
          <Link href="/simulations">
            <Button variant="outline" disabled={starting}>
              Cancel
            </Button>
          </Link>
        </div>
      </RetroCard>
    </div>
  );
}
