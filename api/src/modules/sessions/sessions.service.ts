import { asc, desc, eq, sql } from 'drizzle-orm';

import type { AgentClient } from '../../agent/client.js';
import type {
  AgentAnalysis,
  AgentConversationResponse,
  AgentGoalProgress,
  AgentMessage,
  AgentWireState,
} from '../../agent/types.js';
import type { AppDatabase } from '../../db/client.js';
import { messages, sessions, type MessageRow, type SessionRow } from '../../db/schema.js';
import { forbidden, notFound } from '../../plugins/errors.js';

export interface Range {
  min: number;
  max: number;
}

/**
 * Persona-derived timing hints exposed on session detail so clients can
 * mirror the Gradio dev UI's behaviour (typing delays, inactivity countdown,
 * burst displays). Any field the underlying persona config does not declare
 * is returned as `null`.
 */
/**
 * Tri-state for `startsConversation`:
 * - `true` / `false` — persona always / never opens the session.
 * - `'sometimes'` — persona opens the session with ~50% probability.
 *   The agent resolves the coin flip once at init time; this field still
 *   reflects the raw persona *behaviour* so clients can surface it as
 *   "sometimes opens" in the UI regardless of how this particular session
 *   actually went.
 * - `null` — the persona declared no value (missing / unknown).
 */
export type StartsConversation = boolean | 'sometimes' | null;

export interface SessionConfig {
  starts_conversation: StartsConversation;
  typing_speed_wpm: number | null;
  inactivity_nudge_delay_sec: Range | null;
  max_inactivity_nudges: number | null;
  burstiness: Range | null;
}

export interface SessionDetail {
  id: string;
  simulation_slug: string;
  created_at: string;
  updated_at: string;
  messages: Array<{
    id: string;
    role: 'human' | 'ai';
    content: string;
    order_index: number;
    typing_delay_ms: number | null;
    created_at: string;
  }>;
  goal_progress: AgentGoalProgress[];
  analysis: AgentAnalysis;
  session_config: SessionConfig;
}

export interface SessionSummary {
  id: string;
  simulation_slug: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export type NudgeSkipReason =
  | 'no_human_activity'
  | 'not_enough_idle'
  | 'budget_exhausted'
  /** Persona did not declare inactivity-nudge config (or set
   *  `inactivityNudges.max` to 0). The server fires zero nudges for this
   *  session — clients can stop polling. */
  | 'nudges_disabled'
  /** Idle + budget OK, but the agent graph returned without appending a new
   *  AI message (e.g. a proactive guard inside the graph short-circuited).
   *  We refund the budget slot so clients can try again later. */
  | 'agent_silent';

export type NudgeResult =
  | { nudged: true; session: SessionDetail }
  | { nudged: false; reason: NudgeSkipReason; idle_seconds: number; nudge_count: number };

interface PersonaPolicy {
  delay: Range;
  maxNudges: number;
}

export interface SessionsService {
  create(userId: string, simulationSlug: string): Promise<SessionDetail>;
  get(userId: string, sessionId: string): Promise<SessionDetail>;
  list(userId: string): Promise<SessionSummary[]>;
  postMessage(userId: string, sessionId: string, content: string): Promise<SessionDetail>;
  /**
   * Batch proactive followup — the AI decides to chime in after its own last
   * message. Not rate-limited; the frontend decides when to ask.
   */
  triggerFollowup(userId: string, sessionId: string): Promise<SessionDetail>;
  /**
   * Persona-driven inactivity nudge. The persona's `inactivityNudgeDelaySec`
   * bounds how long the server waits since the last activity (human reply
   * OR previous nudge), and `inactivityNudges.max` caps the total fires per
   * silence window. Idempotent: clients can poll freely.
   */
  triggerInactivityNudge(userId: string, sessionId: string): Promise<NudgeResult>;
  /**
   * Load a session and hand back the snapshot needed to drive an SSE proxy,
   * plus a persist callback for when the stream's final `done` arrives.
   * Used for both turn/stream and proactive/stream.
   */
  prepareStream(
    userId: string,
    sessionId: string,
  ): Promise<{
    session: SessionRow;
    persist: (finalState: AgentWireState, newMessages: AgentMessage[]) => Promise<SessionDetail>;
  }>;
}

/**
 * Extract the persona's conversationStyle from a state snapshot. Returns
 * `{}` if the persona (or the style block) is missing, so callers can safely
 * default individual fields.
 */
function readConversationStyle(snapshot: AgentWireState): Record<string, unknown> {
  const persona = (snapshot.persona ?? {}) as Record<string, unknown>;
  const style = persona.conversationStyle;
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

function readRange(value: unknown): Range | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const min = typeof obj.min === 'number' ? obj.min : null;
  const max = typeof obj.max === 'number' ? obj.max : null;
  if (min === null || max === null) return null;
  return { min, max: Math.max(max, min) };
}

export function extractSessionConfig(snapshot: AgentWireState): SessionConfig {
  const style = readConversationStyle(snapshot);
  const startsRaw = style.startsConversation;
  // Personas declare `true`, `false`, or `"sometimes"`. Anything else
  // (undefined, nulls, typos) collapses to `null` so clients can treat
  // the field as "unknown" and hide the badge.
  const startsConversation: StartsConversation =
    typeof startsRaw === 'boolean'
      ? startsRaw
      : startsRaw === 'sometimes'
        ? 'sometimes'
        : null;
  const typing = typeof style.typingSpeedWpm === 'number' ? style.typingSpeedWpm : null;
  const nudgeMax =
    style.inactivityNudges &&
    typeof (style.inactivityNudges as Record<string, unknown>).max === 'number'
      ? ((style.inactivityNudges as Record<string, unknown>).max as number)
      : null;

  return {
    starts_conversation: startsConversation,
    typing_speed_wpm: typing,
    inactivity_nudge_delay_sec: readRange(style.inactivityNudgeDelaySec),
    max_inactivity_nudges: nudgeMax,
    burstiness: readRange(style.burstiness),
  };
}

/**
 * Resolve the effective nudge policy for a session directly from the
 * persona's `conversationStyle`. The API trusts whatever the agent
 * declared — if a field is missing we fall back to 0, which effectively
 * disables inactivity nudges for that persona (the budget check returns
 * `nudges_disabled` on the first poll).
 */
export function resolvePersonaPolicy(snapshot: AgentWireState): PersonaPolicy {
  const cfg = extractSessionConfig(snapshot);

  const delayMin = cfg.inactivity_nudge_delay_sec?.min ?? 0;
  const delayMax = Math.max(cfg.inactivity_nudge_delay_sec?.max ?? 0, delayMin);
  const maxNudges = Math.max(0, cfg.max_inactivity_nudges ?? 0);

  return { delay: { min: delayMin, max: delayMax }, maxNudges };
}

/**
 * Deterministic pseudo-random pick inside `[min, max]`. Using a stable seed
 * means every poll within the same silence window returns the same threshold,
 * so idle ramps up monotonically until we fire. The seed rotates on the next
 * human reply (via `lastHumanAt`) and after each fired nudge (via `nudgeIdx`).
 */
export function pickNudgeDelaySec(seed: string, min: number, max: number): number {
  if (max <= min) return min;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  const span = max - min + 1;
  return min + (hash % span);
}

export function createSessionsService(db: AppDatabase, agent: AgentClient): SessionsService {
  async function loadSessionOrThrow(userId: string, sessionId: string): Promise<SessionRow> {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!row) throw notFound('Session not found');
    if (row.userId !== userId) throw forbidden('You do not own this session');
    return row;
  }

  async function buildDetail(session: SessionRow): Promise<SessionDetail> {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, session.id))
      .orderBy(asc(messages.orderIndex));
    const snapshot = session.stateSnapshot;
    return {
      id: session.id,
      simulation_slug: session.simulationSlug,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        order_index: m.orderIndex,
        typing_delay_ms: m.typingDelayMs,
        created_at: m.createdAt.toISOString(),
      })),
      goal_progress: snapshot.goal_progress ?? [],
      analysis: {
        user_sentiment: snapshot.last_user_sentiment ?? null,
        user_emotion: snapshot.last_user_emotion ?? null,
        ai_sentiment: snapshot.last_ai_sentiment ?? null,
        ai_emotion: snapshot.last_ai_emotion ?? null,
      },
      session_config: extractSessionConfig(snapshot),
    };
  }

  async function persistMessageDelta(
    sessionId: string,
    existingCount: number,
    agentMessages: AgentMessage[],
  ): Promise<void> {
    if (agentMessages.length <= existingCount) return;
    const delta = agentMessages.slice(existingCount);
    const values = delta.map((m, i) => ({
      sessionId,
      role: m.role,
      content: m.content,
      orderIndex: existingCount + i,
      typingDelayMs: null as number | null,
    }));
    await db.insert(messages).values(values);
  }

  interface UpdatePatch {
    stateSnapshot?: AgentWireState;
    lastHumanMessageAt?: Date | null;
    lastNudgeAt?: Date | null;
    nudgeCountSinceHuman?: number;
  }

  async function updateSession(sessionId: string, patch: UpdatePatch): Promise<SessionRow> {
    const [updated] = await db
      .update(sessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning();
    if (!updated) throw notFound('Session not found');
    return updated;
  }

  async function countMessages(sessionId: string): Promise<number> {
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));
    return row?.c ?? 0;
  }

  async function applyResponse(
    session: SessionRow,
    response: AgentConversationResponse,
    patch: UpdatePatch = {},
  ): Promise<SessionDetail> {
    const existing = await countMessages(session.id);
    await persistMessageDelta(session.id, existing, response.state.messages ?? []);
    const updated = await updateSession(session.id, {
      stateSnapshot: response.state,
      ...patch,
    });
    return buildDetail(updated);
  }

  /** Build the post-human patch: clocks reset, nudge budget reset. */
  function humanTurnPatch(now: Date): UpdatePatch {
    return {
      lastHumanMessageAt: now,
      lastNudgeAt: null,
      nudgeCountSinceHuman: 0,
    };
  }

  return {
    async create(userId, simulationSlug) {
      const response = await agent.initConversation({ simulationSlug });
      const [row] = await db
        .insert(sessions)
        .values({
          userId,
          simulationSlug,
          stateSnapshot: response.state,
        })
        .returning();
      if (!row) throw new Error('Failed to create session');

      const agentMessages = response.state.messages ?? [];
      if (agentMessages.length > 0) {
        await persistMessageDelta(row.id, 0, agentMessages);
      }
      return buildDetail(row);
    },

    async get(userId, sessionId) {
      const session = await loadSessionOrThrow(userId, sessionId);
      return buildDetail(session);
    },

    async list(userId) {
      const sessionRows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt));
      if (sessionRows.length === 0) return [];

      const counts = await db
        .select({
          sessionId: messages.sessionId,
          count: sql<number>`count(*)::int`,
        })
        .from(messages)
        .groupBy(messages.sessionId);

      const byId = new Map(counts.map((c) => [c.sessionId, Number(c.count)]));
      return sessionRows.map((r) => ({
        id: r.id,
        simulation_slug: r.simulationSlug,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
        message_count: byId.get(r.id) ?? 0,
      }));
    },

    async postMessage(userId, sessionId, content) {
      const session = await loadSessionOrThrow(userId, sessionId);
      const response = await agent.turn({
        state: session.stateSnapshot,
        userMessage: content,
      });
      return applyResponse(session, response, humanTurnPatch(new Date()));
    },

    async triggerFollowup(userId, sessionId) {
      const session = await loadSessionOrThrow(userId, sessionId);
      const response = await agent.proactive({
        state: session.stateSnapshot,
        triggerType: 'followup',
      });
      // Followups do NOT reset the inactivity clock or the nudge budget — the
      // session is still waiting for the human.
      return applyResponse(session, response);
    },

    async triggerInactivityNudge(userId, sessionId) {
      const session = await loadSessionOrThrow(userId, sessionId);
      const now = new Date();

      // Policy is derived purely from the persona's conversationStyle — the
      // API trusts whatever the agent declared (mirroring the Gradio dev UI).
      const persona = resolvePersonaPolicy(session.stateSnapshot);

      // Persona explicitly opted out of inactivity nudges (or never declared
      // the config at all). Short-circuit before touching the idle math so
      // the caller gets a crisp signal instead of a misleading
      // `budget_exhausted` on every poll.
      if (persona.maxNudges <= 0) {
        const baselineMs = (session.lastHumanMessageAt ?? session.createdAt).getTime();
        return {
          nudged: false,
          reason: 'nudges_disabled',
          idle_seconds: Math.floor((now.getTime() - baselineMs) / 1000),
          nudge_count: session.nudgeCountSinceHuman,
        };
      }

      // The countdown to the *next* nudge resets every time anything in the
      // conversation happens — a human reply OR a fired nudge. Without this,
      // once the first nudge fires at e.g. 72s, the 77s / 82s ticks still
      // see 77 / 82 seconds of idle, so every subsequent tick past the
      // window would fire too, chaining the persona's `max_nudges` back to
      // back with no gap. Gradio's `Timer` reaches the same effect by
      // resetting its local clock after sending a proactive message.
      const hasHuman = session.lastHumanMessageAt !== null;
      const baselineMs = Math.max(
        (session.lastHumanMessageAt ?? session.createdAt).getTime(),
        session.lastNudgeAt?.getTime() ?? 0,
      );
      const idleSeconds = Math.floor((now.getTime() - baselineMs) / 1000);

      // Stable delay threshold for this idle sub-window. The seed rotates on
      // every human reply (new `lastHumanAt`), after every fired nudge (via
      // the new `baselineMs`), and when the count increments — so each
      // sub-window gets its own pseudo-random pick inside [min, max].
      const seed = `${session.id}:${baselineMs}:${session.nudgeCountSinceHuman}`;
      const pickedDelay = pickNudgeDelaySec(seed, persona.delay.min, persona.delay.max);

      if (idleSeconds < pickedDelay) {
        return {
          nudged: false,
          reason: hasHuman ? 'not_enough_idle' : 'no_human_activity',
          idle_seconds: idleSeconds,
          nudge_count: session.nudgeCountSinceHuman,
        };
      }

      if (session.nudgeCountSinceHuman >= persona.maxNudges) {
        return {
          nudged: false,
          reason: 'budget_exhausted',
          idle_seconds: idleSeconds,
          nudge_count: session.nudgeCountSinceHuman,
        };
      }

      const priorMessageCount = await countMessages(session.id);
      const response = await agent.proactive({
        state: session.stateSnapshot,
        triggerType: 'inactivity',
      });
      const agentMessages = response.state.messages ?? [];

      // If the graph returned without appending anything, we don't want to
      // burn a slot in the persona's nudge budget — otherwise clients see
      // "nudged: true" with zero new content and then `budget_exhausted`
      // on the next call, which is confusing and wasteful.
      if (agentMessages.length <= priorMessageCount) {
        return {
          nudged: false,
          reason: 'agent_silent',
          idle_seconds: idleSeconds,
          nudge_count: session.nudgeCountSinceHuman,
        };
      }

      const detail = await applyResponse(session, response, {
        lastNudgeAt: now,
        nudgeCountSinceHuman: session.nudgeCountSinceHuman + 1,
      });
      return { nudged: true, session: detail };
    },

    async prepareStream(userId, sessionId) {
      const session = await loadSessionOrThrow(userId, sessionId);
      return {
        session,
        persist: async (finalState, newMessages) => {
          const response: AgentConversationResponse = {
            state: finalState,
            messages: newMessages,
            goal_progress: finalState.goal_progress ?? [],
            analysis: {
              user_sentiment: finalState.last_user_sentiment ?? null,
              user_emotion: finalState.last_user_emotion ?? null,
              ai_sentiment: finalState.last_ai_sentiment ?? null,
              ai_emotion: finalState.last_ai_emotion ?? null,
            },
          };
          // The streaming caller decides whether human-turn counters should
          // reset. Today turn/stream always follows a user message, and
          // proactive/stream never does. We detect the former by checking if
          // the incoming delta starts with a HumanMessage.
          const existingCount = await countMessages(session.id);
          const delta = (finalState.messages ?? []).slice(existingCount);
          const isHumanTurn = delta.some((m) => m.role === 'human');
          const patch: UpdatePatch = isHumanTurn ? humanTurnPatch(new Date()) : {};
          return applyResponse(session, response, patch);
        },
      };
    },
  };
}

export type { MessageRow };
