import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

import type { AgentDebriefReport, AgentWireState } from '../agent/types.js';

export const messageRoleEnum = pgEnum('message_role', ['human', 'ai']);

/**
 * Where a message originated. `text` is the default web chat path; `voice`
 * marks turns that flowed through a LiveKit voice call (the spoken user
 * transcript and the persona's spoken replies). The UI uses this to split
 * the transcript with "voice call" dividers and to label call segments.
 */
export const messageSourceEnum = pgEnum('message_source', ['text', 'voice']);

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'verify_email',
  'login_link',
  'reset_password',
  'change_email',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    // Nullable so passwordless accounts (magic-link signup) can exist until
    // the user chooses to set a password from /profile.
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurposeEnum('purpose').notNull(),
    // Hash of the opaque magic-link / reset token (sha256 hex). Null for
    // code-based flows (verify_email, change_email) which store codeHash.
    tokenHash: text('token_hash'),
    // Hash of the 6-digit OTP (argon2id) for code-based flows. Null for
    // link-based flows.
    codeHash: text('code_hash'),
    // For change_email flow, the pending new address the code was sent to.
    newEmail: text('new_email'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
    index('auth_tokens_token_hash_idx').on(t.tokenHash),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    simulationSlug: text('simulation_slug').notNull(),
    stateSnapshot: jsonb('state_snapshot').$type<AgentWireState>().notNull(),
    // Optimistic-concurrency guard for turn processing. Every state persist
    // bumps it (`SET version = version + 1 WHERE version = <loaded>`); a
    // zero-row update means another turn committed since this one loaded the
    // snapshot, and the caller gets a 409 instead of silently losing data.
    version: integer('version').notNull().default(0),
    lastHumanMessageAt: timestamp('last_human_message_at', { withTimezone: true }),
    lastNudgeAt: timestamp('last_nudge_at', { withTimezone: true }),
    nudgeCountSinceHuman: integer('nudge_count_since_human').notNull().default(0),
    // Voice mode bookkeeping. Both nullable + only set while a voice
    // call is active for this session — the values let the eval node
    // know the call window without needing a separate table for the
    // single most recent call. Multi-call analytics live on
    // `voice_minute_usage` (per-user, per-day) below.
    voiceCallStartedAt: timestamp('voice_call_started_at', { withTimezone: true }),
    voiceCallEndedAt: timestamp('voice_call_ended_at', { withTimezone: true }),
    // Cached post-session debrief report, generated on demand by the agent's
    // `/conversation/debrief`. `reportMessageCount` records how long the
    // transcript was when the report was generated: a mismatch with the
    // current snapshot means the conversation advanced and the report is
    // regenerated on the next `GET /sessions/:id/report`. Deliberately NOT
    // version-guarded — the report never touches `state_snapshot`, so a
    // report write must never 409 a concurrent turn (or vice versa).
    report: jsonb('report').$type<AgentDebriefReport>(),
    reportMessageCount: integer('report_message_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.createdAt)],
);

/**
 * Per-user-per-day voice minute usage.
 *
 * Each row tracks one user's cumulative voice minutes for a single
 * UTC date. `secondsUsed` is incremented on every successful
 * `/sessions/:id/voice/end` call; the cap (`VOICE_DAILY_MINUTES_PER_USER`,
 * default 20 minutes) is enforced at `/voice/start` time before the
 * LiveKit token is minted.
 *
 * Storing the day as a `text` (`YYYY-MM-DD`, UTC) rather than a
 * `date` keeps PGlite-backed tests and Postgres production identical
 * — PGlite has spotty tz handling around `date` casts. The row count
 * scales with active users, not call volume, so this is fine.
 */
export const voiceMinuteUsage = pgTable(
  'voice_minute_usage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(),
    secondsUsed: integer('seconds_used').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('voice_minute_usage_user_day_unique').on(t.userId, t.usageDate),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    orderIndex: integer('order_index').notNull(),
    source: messageSourceEnum('source').notNull().default('text'),
    typingDelayMs: integer('typing_delay_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_session_idx').on(t.sessionId, t.orderIndex)],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  authTokens: many(authTokens),
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(sessions, { fields: [messages.sessionId], references: [sessions.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type AuthTokenRow = typeof authTokens.$inferSelect;
export type NewAuthTokenRow = typeof authTokens.$inferInsert;
export type AuthTokenPurpose = (typeof authTokenPurposeEnum.enumValues)[number];
export type MessageSource = (typeof messageSourceEnum.enumValues)[number];
export type VoiceMinuteUsageRow = typeof voiceMinuteUsage.$inferSelect;
export type NewVoiceMinuteUsageRow = typeof voiceMinuteUsage.$inferInsert;
