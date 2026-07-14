import { asc, eq, sql } from 'drizzle-orm';

import type { AgentDebriefReport, AgentGoalProgress } from '../../agent/types.js';
import type { AppDatabase } from '../../db/client.js';
import { messages, sessions, voiceMinuteUsage } from '../../db/schema.js';

// ---------------------------------------------------------------------------
// Aggregate, per-user analytics assembled from three sources:
//   1. every session's `goal_progress` snapshot (deterministic — covers all
//      sessions, whether or not a debrief report was ever generated)
//   2. transcript rows (message counts, wall-clock practice time)
//   3. cached debrief reports (skill scores, tone — only for sessions the
//      user has opened a report for)
// The user's session count is small (session creation is rate-limited to a
// handful per day), so aggregation happens in-process over the loaded rows
// rather than in SQL.
// ---------------------------------------------------------------------------

export interface SkillAverage {
  key: string;
  /** Mean 0-100 score across analyzed sessions. */
  average: number;
  /** Number of reports that carried this skill. */
  count: number;
}

export interface ScoreTrendPoint {
  session_id: string;
  simulation_slug: string;
  /** Session creation time — the trend is ordered by this. */
  created_at: string;
  overall_score: number;
  /** Per-skill scores keyed by skill key. */
  skills: Record<string, number>;
}

export interface ToneCount {
  tone: string;
  count: number;
}

export interface PhraseCount {
  text: string;
  count: number;
}

export interface SimulationBreakdown {
  simulation_slug: string;
  sessions: number;
  completed_sessions: number;
  /** Best cached-report overall score, when any session was analyzed. */
  best_overall_score: number | null;
  /** Best "required goals achieved / required goals" across attempts. */
  best_goals_achieved: number;
  goals_required: number;
  last_played_at: string;
}

export interface AnalyticsOverview {
  totals: {
    sessions: number;
    simulations_tried: number;
    messages: number;
    user_messages: number;
    /** Sum of per-session first→last message wall-clock spans. */
    practice_seconds: number;
    /** Lifetime voice-call seconds from `voice_minute_usage`. */
    voice_seconds: number;
  };
  goals: {
    /** Required goals achieved, summed across all sessions. */
    achieved: number;
    /** Required goals tracked, summed across all sessions. */
    total: number;
    /** Sessions where every required goal is achieved. */
    completed_sessions: number;
    /** Sessions that track at least one goal (the denominator). */
    completable_sessions: number;
    completion_rate: number | null;
  };
  reports: {
    analyzed_sessions: number;
    total_sessions: number;
    average_overall: number | null;
    skill_averages: SkillAverage[];
    /** Chronological, capped to the most recent entries. */
    trend: ScoreTrendPoint[];
    top_strengths: PhraseCount[];
    top_improvement_areas: PhraseCount[];
    tones: ToneCount[];
  };
  per_simulation: SimulationBreakdown[];
}

export interface AnalyticsService {
  overview(userId: string): Promise<AnalyticsOverview>;
}

const TREND_LIMIT = 20;
const TOP_PHRASES_LIMIT = 5;

/**
 * Mirror of the web's `allGoalsAchieved` semantics: score against required
 * goals when any exist, otherwise against all tracked goals.
 */
function scoredGoals(progress: AgentGoalProgress[]): AgentGoalProgress[] {
  const tracked = progress.filter((g) => typeof g === 'object' && g !== null);
  const required = tracked.filter((g) => !g.isOptional);
  return required.length > 0 ? required : tracked;
}

function countAchieved(goals: AgentGoalProgress[]): number {
  return goals.filter((g) => g.status === 'achieved').length;
}

/**
 * Count phrase occurrences (case-insensitive), most frequent first with
 * later (more recent) occurrences winning ties. Returns the original
 * casing of the most recent occurrence.
 */
function topPhrases(phrases: string[], limit: number): PhraseCount[] {
  const counts = new Map<string, { text: string; count: number; lastIndex: number }>();
  phrases.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const key = text.toLowerCase();
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      entry.text = text;
      entry.lastIndex = index;
    } else {
      counts.set(key, { text, count: 1, lastIndex: index });
    }
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.lastIndex - a.lastIndex)
    .slice(0, limit)
    .map(({ text, count }) => ({ text, count }));
}

export function createAnalyticsService(db: AppDatabase): AnalyticsService {
  return {
    async overview(userId) {
      const sessionRows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(asc(sessions.createdAt));

      const messageAgg = await db
        .select({
          sessionId: messages.sessionId,
          role: messages.role,
          count: sql<number>`count(*)::int`,
          first: sql<string | null>`min(${messages.createdAt})`,
          last: sql<string | null>`max(${messages.createdAt})`,
        })
        .from(messages)
        .innerJoin(sessions, eq(messages.sessionId, sessions.id))
        .where(eq(sessions.userId, userId))
        .groupBy(messages.sessionId, messages.role);

      const [voiceAgg] = await db
        .select({
          total: sql<number>`coalesce(sum(${voiceMinuteUsage.secondsUsed}), 0)::int`,
        })
        .from(voiceMinuteUsage)
        .where(eq(voiceMinuteUsage.userId, userId));

      // -- Transcript totals + per-session time bounds -------------------
      let totalMessages = 0;
      let totalUserMessages = 0;
      const boundsBySession = new Map<string, { first: number; last: number }>();
      for (const row of messageAgg) {
        totalMessages += row.count;
        if (row.role === 'human') totalUserMessages += row.count;
        if (row.first && row.last) {
          const first = new Date(row.first).getTime();
          const last = new Date(row.last).getTime();
          const existing = boundsBySession.get(row.sessionId);
          boundsBySession.set(row.sessionId, {
            first: existing ? Math.min(existing.first, first) : first,
            last: existing ? Math.max(existing.last, last) : last,
          });
        }
      }
      let practiceSeconds = 0;
      for (const { first, last } of boundsBySession.values()) {
        practiceSeconds += Math.max(0, Math.round((last - first) / 1000));
      }

      // -- Goal aggregation (all sessions) -------------------------------
      let goalsAchieved = 0;
      let goalsTotal = 0;
      let completedSessions = 0;
      let completableSessions = 0;
      const completedBySession = new Map<string, boolean>();
      for (const row of sessionRows) {
        const scored = scoredGoals(row.stateSnapshot.goal_progress ?? []);
        if (scored.length === 0) continue;
        completableSessions += 1;
        const achieved = countAchieved(scored);
        goalsAchieved += achieved;
        goalsTotal += scored.length;
        const completed = achieved === scored.length;
        completedBySession.set(row.id, completed);
        if (completed) completedSessions += 1;
      }

      // -- Report aggregation (analyzed sessions only) --------------------
      const analyzed = sessionRows.filter(
        (row): row is (typeof sessionRows)[number] & { report: AgentDebriefReport } =>
          row.report !== null && typeof row.report === 'object',
      );

      const skillSums = new Map<string, { sum: number; count: number }>();
      const strengths: string[] = [];
      const improvements: string[] = [];
      const toneCounts = new Map<string, number>();
      let overallSum = 0;

      for (const row of analyzed) {
        const report = row.report;
        overallSum += report.overall_score;
        for (const skill of report.skills ?? []) {
          if (typeof skill.score !== 'number' || !skill.key) continue;
          const entry = skillSums.get(skill.key) ?? { sum: 0, count: 0 };
          entry.sum += skill.score;
          entry.count += 1;
          skillSums.set(skill.key, entry);
        }
        strengths.push(...(report.strengths ?? []));
        improvements.push(...(report.improvement_areas ?? []));
        const tone = (report.emotional_tone?.overall ?? '').trim().toLowerCase();
        if (tone) toneCounts.set(tone, (toneCounts.get(tone) ?? 0) + 1);
      }

      const trend: ScoreTrendPoint[] = analyzed.slice(-TREND_LIMIT).map((row) => ({
        session_id: row.id,
        simulation_slug: row.simulationSlug,
        created_at: row.createdAt.toISOString(),
        overall_score: row.report.overall_score,
        skills: Object.fromEntries(
          (row.report.skills ?? [])
            .filter((s) => typeof s.score === 'number' && s.key)
            .map((s) => [s.key, s.score]),
        ),
      }));

      // -- Per-simulation breakdown ---------------------------------------
      const bySimulation = new Map<string, SimulationBreakdown>();
      for (const row of sessionRows) {
        const slug = row.simulationSlug;
        const scored = scoredGoals(row.stateSnapshot.goal_progress ?? []);
        const achieved = countAchieved(scored);
        const overall = row.report?.overall_score ?? null;
        const lastPlayed = row.updatedAt.toISOString();

        const entry = bySimulation.get(slug);
        if (!entry) {
          bySimulation.set(slug, {
            simulation_slug: slug,
            sessions: 1,
            completed_sessions: completedBySession.get(row.id) ? 1 : 0,
            best_overall_score: overall,
            best_goals_achieved: achieved,
            goals_required: scored.length,
            last_played_at: lastPlayed,
          });
          continue;
        }
        entry.sessions += 1;
        if (completedBySession.get(row.id)) entry.completed_sessions += 1;
        if (overall !== null) {
          entry.best_overall_score =
            entry.best_overall_score === null
              ? overall
              : Math.max(entry.best_overall_score, overall);
        }
        if (achieved > entry.best_goals_achieved) {
          entry.best_goals_achieved = achieved;
        }
        entry.goals_required = Math.max(entry.goals_required, scored.length);
        if (lastPlayed > entry.last_played_at) entry.last_played_at = lastPlayed;
      }
      const perSimulation = [...bySimulation.values()].sort((a, b) =>
        b.last_played_at.localeCompare(a.last_played_at),
      );

      return {
        totals: {
          sessions: sessionRows.length,
          simulations_tried: new Set(sessionRows.map((r) => r.simulationSlug)).size,
          messages: totalMessages,
          user_messages: totalUserMessages,
          practice_seconds: practiceSeconds,
          voice_seconds: voiceAgg?.total ?? 0,
        },
        goals: {
          achieved: goalsAchieved,
          total: goalsTotal,
          completed_sessions: completedSessions,
          completable_sessions: completableSessions,
          completion_rate:
            completableSessions > 0
              ? Math.round((completedSessions / completableSessions) * 100) / 100
              : null,
        },
        reports: {
          analyzed_sessions: analyzed.length,
          total_sessions: sessionRows.length,
          average_overall:
            analyzed.length > 0 ? Math.round(overallSum / analyzed.length) : null,
          skill_averages: [...skillSums.entries()].map(([key, { sum, count }]) => ({
            key,
            average: Math.round(sum / count),
            count,
          })),
          trend,
          top_strengths: topPhrases(strengths, TOP_PHRASES_LIMIT),
          top_improvement_areas: topPhrases(improvements, TOP_PHRASES_LIMIT),
          tones: [...toneCounts.entries()]
            .map(([tone, count]) => ({ tone, count }))
            .sort((a, b) => b.count - a.count),
        },
        per_simulation: perSimulation,
      };
    },
  };
}
