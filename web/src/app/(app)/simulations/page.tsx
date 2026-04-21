'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { apiClient } from '@/lib/api';
import type { Simulation } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroBadge } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';

export default function SimulationsPage() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const sims = await apiClient.listSimulations();
        if (!cancelled) setSimulations(sims);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to load simulations',
          );
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-retro tracking-wider2 text-retro-ink dark:text-retro-ink-dark">
          SIMULATIONS
        </h1>
        <p className="text-sm text-secondary-600 dark:text-secondary-400 mt-1">
          Start a new conversation with one of the available personas.
        </p>
      </div>

      {simulations.length === 0 ? (
        <RetroCard>
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            No simulations available yet. Check back soon.
          </p>
        </RetroCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {simulations.map((sim) => (
            <RetroCard
              key={sim.slug}
              title={sim.title}
              subtitle={
                <span className="font-monoRetro">{sim.slug}</span>
              }
            >
              <div className="space-y-3">
                <div>
                  <RetroBadge color="cyan">{sim.persona_name}</RetroBadge>
                </div>
                <Link href={`/simulations/${encodeURIComponent(sim.slug)}`}>
                  <Button className="w-full" variant="primary">
                    Start session
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
