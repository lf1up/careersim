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
  | 'budget_exhausted';

export type NudgeResult =
  | { nudged: true; session: SessionDetail }
  | { nudged: false; reason: NudgeSkipReason; idle_seconds: number; nudge_count: number };

export interface NudgePolicy {
  minIdleSeconds: number;
  maxPerSilence: number;
  now?: () => Date;
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
   * Guardrailed inactivity nudge. Enforces `minIdleSeconds` since the last
   * human message and `maxPerSilence` between two human messages. Idempotent:
   * can be called freely; the server decides whether to dispatch to the agent.
   */
  triggerInactivityNudge(
    userId: string,
    sessionId: string,
    policy: NudgePolicy,
  ): Promise<NudgeResult>;
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

    async triggerInactivityNudge(userId, sessionId, policy) {
      const session = await loadSessionOrThrow(userId, sessionId);
      const now = policy.now?.() ?? new Date();

      if (!session.lastHumanMessageAt) {
        // Pre-first-human state: we treat the session itself as the baseline.
        // This lets a persona that opens the conversation also fire a nudge
        // after N seconds of silence.
        const baseline = session.createdAt;
        const idleSeconds = Math.floor((now.getTime() - baseline.getTime()) / 1000);
        if (idleSeconds < policy.minIdleSeconds) {
          return {
            nudged: false,
            reason: 'no_human_activity',
            idle_seconds: idleSeconds,
            nudge_count: session.nudgeCountSinceHuman,
          };
        }
      } else {
        const idleSeconds = Math.floor(
          (now.getTime() - session.lastHumanMessageAt.getTime()) / 1000,
        );
        if (idleSeconds < policy.minIdleSeconds) {
          return {
            nudged: false,
            reason: 'not_enough_idle',
            idle_seconds: idleSeconds,
            nudge_count: session.nudgeCountSinceHuman,
          };
        }
      }

      if (session.nudgeCountSinceHuman >= policy.maxPerSilence) {
        const baseline = session.lastHumanMessageAt ?? session.createdAt;
        return {
          nudged: false,
          reason: 'budget_exhausted',
          idle_seconds: Math.floor((now.getTime() - baseline.getTime()) / 1000),
          nudge_count: session.nudgeCountSinceHuman,
        };
      }

      const response = await agent.proactive({
        state: session.stateSnapshot,
        triggerType: 'inactivity',
      });
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
