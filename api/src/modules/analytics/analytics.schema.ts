import { z } from 'zod';

export const skillAverageSchema = z.object({
  key: z.string(),
  average: z.number(),
  count: z.number().int(),
});

export const scoreTrendPointSchema = z.object({
  session_id: z.uuid(),
  simulation_slug: z.string(),
  created_at: z.string(),
  overall_score: z.number(),
  skills: z.record(z.string(), z.number()),
});

export const phraseCountSchema = z.object({
  text: z.string(),
  count: z.number().int(),
});

export const toneCountSchema = z.object({
  tone: z.string(),
  count: z.number().int(),
});

export const simulationBreakdownSchema = z.object({
  simulation_slug: z.string(),
  sessions: z.number().int(),
  completed_sessions: z.number().int(),
  best_overall_score: z.number().nullable(),
  best_goals_achieved: z.number().int(),
  goals_required: z.number().int(),
  last_played_at: z.string(),
});

export const analyticsOverviewSchema = z.object({
  totals: z.object({
    sessions: z.number().int(),
    simulations_tried: z.number().int(),
    messages: z.number().int(),
    user_messages: z.number().int(),
    practice_seconds: z.number().int(),
    voice_seconds: z.number().int(),
  }),
  goals: z.object({
    achieved: z.number().int(),
    total: z.number().int(),
    completed_sessions: z.number().int(),
    completable_sessions: z.number().int(),
    completion_rate: z.number().nullable(),
  }),
  reports: z.object({
    analyzed_sessions: z.number().int(),
    total_sessions: z.number().int(),
    average_overall: z.number().nullable(),
    skill_averages: z.array(skillAverageSchema),
    trend: z.array(scoreTrendPointSchema),
    top_strengths: z.array(phraseCountSchema),
    top_improvement_areas: z.array(phraseCountSchema),
    tones: z.array(toneCountSchema),
  }),
  per_simulation: z.array(simulationBreakdownSchema),
});
