import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppDatabase } from '../../db/client.js';
import { HttpError } from '../../plugins/errors.js';
import { rateLimitPolicy } from '../../plugins/rate-limit.js';
import { createVoiceService, type VoiceServiceConfig } from './voice.service.js';
import {
  stateForVoiceResponseSchema,
  voiceBudgetResponseSchema,
  voiceEndResponseSchema,
  voiceEndSchema,
  voiceStartResponseSchema,
} from './voice.schema.js';

export interface VoiceRouteOptions {
  db: AppDatabase;
  config: VoiceServiceConfig;
  /**
   * Shared secret the agent-voice worker must send as `X-Internal-Key`
   * on `/internal/sessions/:id/state-for-voice`. We reuse
   * `AGENT_INTERNAL_KEY` since the worker and agent already share that
   * trust boundary; when empty the route still 401s rather than
   * silently allowing all callers (the chat side has a "dev mode"
   * fallback because it's outbound; here we're inbound and need to
   * stay strict).
   */
  internalKey: string;
}

export const voiceRoutes: FastifyPluginAsyncZod<VoiceRouteOptions> = async (app, opts) => {
  const service = createVoiceService(opts.db, opts.config);

  // ---------------------------------------------------------------------------
  // POST /sessions/:id/voice/start  — user-bearer-authenticated.
  //
  // Returns a short-lived LiveKit join token + the client-facing SFU URL.
  // ---------------------------------------------------------------------------
  app.post(
    '/sessions/:id/voice/start',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.voiceStart() },
      schema: {
        tags: ['voice'],
        summary: 'Start a voice call for a session',
        description:
          'Mints a short-lived LiveKit join token. Returns 503 voice_disabled when VOICE_ENABLED=false; 429 voice_quota_exhausted when the daily voice budget is used up; 409 voice_call_in_progress when the user already has an active call.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        response: { 200: voiceStartResponseSchema },
      },
    },
    async (request) => {
      // Pull the bearer token straight off the request — we forward it
      // to the agent-voice worker via the room metadata so the worker
      // can re-enter the API as the user when persisting turns.
      const authHeader = request.headers.authorization ?? '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : '';
      if (!bearerToken) {
        throw new HttpError(401, 'Missing bearer token', 'unauthorized');
      }

      const result = await service.startCall({
        userId: request.user.sub,
        sessionId: request.params.id,
        bearerToken,
      });

      return {
        token: result.token,
        livekit_url: result.livekitUrl,
        room: result.room,
        expires_at: result.expiresAt.toISOString(),
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /sessions/:id/voice/end  — user-bearer-authenticated.
  //
  // Marks the session call-ended (clearing the single-active-call guard) and
  // returns the remaining budget so the UI can surface it. Does NOT debit the
  // quota — that is the agent-voice worker's job via the internal end route,
  // using a server-side authoritative clock the client can't influence. The
  // body is still accepted for backward compatibility but ignored for debit.
  // ---------------------------------------------------------------------------
  app.post(
    '/sessions/:id/voice/end',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['voice'],
        summary: 'End a voice call (marks ended; quota debit is worker-authoritative)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
        body: voiceEndSchema,
        response: { 200: voiceEndResponseSchema },
      },
    },
    async (request) => {
      const result = await service.endCall({
        userId: request.user.sub,
        sessionId: request.params.id,
      });
      return {
        seconds_recorded: result.secondsRecorded,
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /internal/sessions/:id/state-for-voice  — internal-key-authenticated.
  //
  // The agent-voice worker pulls the freshest wire-format state right before
  // joining a LiveKit room. This route deliberately bypasses the user JWT
  // chain — it's part of the API <-> worker trust boundary, not a public
  // endpoint.
  // ---------------------------------------------------------------------------
  app.get(
    '/internal/sessions/:id/state-for-voice',
    {
      schema: {
        tags: ['voice'],
        summary: 'Internal: fetch wire-state snapshot for a voice session',
        params: z.object({ id: z.uuid() }),
        response: { 200: stateForVoiceResponseSchema },
        // Hidden from the OpenAPI surface — internal-only.
        hide: true,
      },
    },
    async (request) => {
      assertInternalCaller(request.headers['x-internal-key']);
      return service.fetchStateForVoice(request.params.id);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /internal/sessions/:id/voice-budget  — internal-key-authenticated.
  //
  // The agent-voice worker reads the session owner's remaining daily voice
  // budget at call start so it can arm a mid-call cutoff watchdog. Keyed by
  // session (the worker only knows the session id, not the user).
  // ---------------------------------------------------------------------------
  app.get(
    '/internal/sessions/:id/voice-budget',
    {
      schema: {
        tags: ['voice'],
        summary: 'Internal: remaining daily voice budget for a session owner',
        params: z.object({ id: z.uuid() }),
        response: { 200: voiceBudgetResponseSchema },
        hide: true,
      },
    },
    async (request) => {
      assertInternalCaller(request.headers['x-internal-key']);
      const budget = await service.getBudgetForSession(request.params.id);
      return {
        remaining_seconds: budget.remainingSeconds,
        cap_seconds: budget.capSeconds,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /internal/sessions/:id/voice/end  — internal-key-authenticated.
  //
  // Authoritative call-end from the agent-voice worker. Debits the session
  // owner's daily quota by the worker-measured seconds (server-side clock the
  // client can't influence) and merges aggregate voice analytics. This is the
  // single source of truth for quota debits.
  // ---------------------------------------------------------------------------
  app.post(
    '/internal/sessions/:id/voice/end',
    {
      schema: {
        tags: ['voice'],
        summary: 'Internal: authoritative voice-call end + quota debit',
        params: z.object({ id: z.uuid() }),
        body: voiceEndSchema,
        response: { 200: voiceEndResponseSchema },
        hide: true,
      },
    },
    async (request) => {
      assertInternalCaller(request.headers['x-internal-key']);
      const result = await service.endCallInternal({
        sessionId: request.params.id,
        secondsUsed: request.body.seconds_used,
        voiceAnalysis: request.body.voice_analysis,
      });
      return {
        seconds_recorded: result.secondsRecorded,
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  // Shared guard for the internal worker<->API routes. Honours the kill
  // switch BEFORE the internal-key check so the worker gets a clear
  // `voice_disabled` signal even when its shared secret matches — that way
  // it can stop polling instead of retrying on a 401 it can't fix.
  function assertInternalCaller(provided: unknown): void {
    if (!opts.config.enabled) {
      throw new HttpError(503, 'Voice mode is disabled', 'voice_disabled');
    }
    const expected = opts.internalKey;
    if (!expected) {
      throw new HttpError(
        503,
        'Internal voice routes are disabled (AGENT_INTERNAL_KEY unset)',
        'voice_internal_disabled',
      );
    }
    if (typeof provided !== 'string' || provided !== expected) {
      throw new HttpError(401, 'Internal key required', 'unauthorized');
    }
  }
};
