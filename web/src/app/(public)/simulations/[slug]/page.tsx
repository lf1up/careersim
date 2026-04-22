'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

import { apiClient, ApiError } from '@/lib/api';
import type { SimulationDetail } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { difficultyColor, difficultyLabel } from '@/lib/simulation-meta';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RetroCard } from '@/components/ui/RetroCard';
import { RetroBadge, RetroAlert } from '@/components/ui/RetroBadge';
import { Button } from '@/components/ui/Button';

function humanizeCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  return category
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

interface SectionListProps {
  title: string;
  items: string[];
  empty?: string;
}

const SectionList: React.FC<SectionListProps> = ({ title, items, empty }) => {
  if (items.length === 0 && !empty) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wider2 text-secondary-600 dark:text-secondary-400 mb-2">
        {title.toUpperCase()}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-secondary-600 dark:text-secondary-400">
          {empty}
        </p>
      ) : (
        <ul className="list-disc pl-5 space-y-1 text-sm text-retro-ink dark:text-retro-ink-dark">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function SimulationDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [simulation, setSimulation] = useState<SimulationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await apiClient.getSimulation(slug);
        if (!cancelled) setSimulation(detail);
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof ApiError && err.status === 404
              ? `Simulation "${slug}" was not found.`
              : err instanceof Error
                ? err.message
                : 'Failed to load simulation';
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
    // Guests are bounced through register; the `next` param brings them
    // straight back to this simulation page after they sign up, where they
    // can hit "Start session" again with an authenticated session.
    if (!authLoading && !isAuthenticated) {
      const next = `/simulations/${encodeURIComponent(slug)}`;
      router.push(`/register?next=${encodeURIComponent(next)}`);
      return;
    }
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

  const personaCategory = humanizeCategory(simulation.persona_category);
  const hasSuccessCriteria =
    simulation.success_criteria.communication.length > 0 ||
    simulation.success_criteria.problem_solving.length > 0 ||
    simulation.success_criteria.emotional.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 sm:pb-16 retro-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/simulations">
          <Button variant="ghost" size="sm">
            ← All simulations
          </Button>
        </Link>
        <span className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400">
          {simulation.slug}
        </span>
      </div>

      <RetroCard
        title={simulation.title}
        subtitle={
          <span>
            with{' '}
            <span className="font-semibold text-retro-ink dark:text-retro-ink-dark">
              {simulation.persona_name}
            </span>
            {simulation.persona_role && (
              <span className="text-secondary-600 dark:text-secondary-400">
                {' '}
                — {simulation.persona_role}
              </span>
            )}
          </span>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <RetroBadge color={difficultyColor(simulation.difficulty)}>
              {difficultyLabel(simulation.difficulty)}
            </RetroBadge>
            {typeof simulation.estimated_duration_minutes === 'number' && (
              <RetroBadge color="default">
                ~{simulation.estimated_duration_minutes} min
              </RetroBadge>
            )}
            {simulation.conversation_goals.length > 0 && (
              <RetroBadge color="purple">
                {simulation.conversation_goals.length} goal
                {simulation.conversation_goals.length === 1 ? '' : 's'}
              </RetroBadge>
            )}
            {personaCategory && (
              <RetroBadge color="indigo">{personaCategory}</RetroBadge>
            )}
          </div>

          {simulation.description && (
            <p className="text-base text-retro-ink dark:text-retro-ink-dark">
              {simulation.description}
            </p>
          )}

          {simulation.scenario && (
            <div className="border-l-4 border-black dark:border-retro-ink-dark pl-4 py-1 bg-retro-paper dark:bg-retro-surface-dark/40">
              <p className="text-[10px] font-semibold tracking-wider2 text-secondary-600 dark:text-secondary-400 mb-1">
                SCENARIO
              </p>
              <p className="text-sm text-retro-ink dark:text-retro-ink-dark">
                {simulation.scenario}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="primary"
              isLoading={starting}
              onClick={handleStart}
            >
              {!authLoading && !isAuthenticated
                ? 'Sign up to start'
                : 'Start session'}
            </Button>
            <Link href="/simulations">
              <Button variant="outline" disabled={starting}>
                Cancel
              </Button>
            </Link>
          </div>
        </div>
      </RetroCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {simulation.objectives.length > 0 && (
          <RetroCard title="Objectives">
            <SectionList title="" items={simulation.objectives} />
          </RetroCard>
        )}

        {simulation.skills_to_learn.length > 0 && (
          <RetroCard title="Skills you'll practice">
            <div className="flex flex-wrap gap-2">
              {simulation.skills_to_learn.map((skill) => (
                <RetroBadge key={skill} color="teal">
                  {skill}
                </RetroBadge>
              ))}
            </div>
          </RetroCard>
        )}
      </div>

      {hasSuccessCriteria && (
        <RetroCard title="How you'll be evaluated">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <SectionList
              title="Communication"
              items={simulation.success_criteria.communication}
            />
            <SectionList
              title="Problem solving"
              items={simulation.success_criteria.problem_solving}
            />
            <SectionList
              title="Emotional"
              items={simulation.success_criteria.emotional}
            />
          </div>
        </RetroCard>
      )}

      {simulation.conversation_goals.length > 0 && (
        <RetroCard
          title="Conversation goals"
          subtitle={
            <span>
              Work through these in roughly this order during the session.
            </span>
          }
        >
          <ol className="space-y-4 retro-stagger">
            {simulation.conversation_goals.map((goal) => (
              <li
                key={goal.goal_number}
                className="border-2 border-black dark:border-retro-ink-dark p-4 shadow-retro-2 dark:shadow-retro-dark-2 bg-white dark:bg-retro-surface-dark"
              >
                <div className="flex items-start gap-3 flex-wrap">
                  <RetroBadge color="yellow">
                    Goal {goal.goal_number}
                  </RetroBadge>
                  <h4 className="font-semibold text-retro-ink dark:text-retro-ink-dark flex-1">
                    {goal.title}
                  </h4>
                  {goal.is_optional && (
                    <RetroBadge color="default">Optional</RetroBadge>
                  )}
                </div>
                <p className="mt-2 text-sm text-retro-ink dark:text-retro-ink-dark">
                  {goal.description}
                </p>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SectionList
                    title="Key behaviors"
                    items={goal.key_behaviors}
                  />
                  <SectionList
                    title="What success looks like"
                    items={goal.success_indicators}
                  />
                </div>
              </li>
            ))}
          </ol>
        </RetroCard>
      )}

      {simulation.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {simulation.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs font-monoRetro text-secondary-600 dark:text-secondary-400"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
