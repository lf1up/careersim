import { sql } from 'drizzle-orm';
import { bigserial, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sessions, users } from '../../db/schema.js';

/** Call identity survives hangup/rejoin so delayed worker callbacks remain isolated. */
export const voiceCalls = pgTable('voice_calls', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ordinal: bigserial('ordinal', { mode: 'number' }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  room: text('room').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  lastCheckpointAt: timestamp('last_checkpoint_at', { withTimezone: true }).notNull(),
  processedSequence: integer('processed_sequence').notNull().default(-1),
  cumulativeSeconds: integer('cumulative_seconds').notNull().default(0),
  chargedSeconds: integer('charged_seconds').notNull().default(0),
}, (t) => [
  uniqueIndex('voice_calls_active_user_unique').on(t.userId).where(sql`${t.endedAt} IS NULL`),
  index('voice_calls_session_idx').on(t.sessionId),
]);
