import { timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppDatabase } from '../../db/client.js';
import { HttpError } from '../../plugins/errors.js';
import { rateLimitPolicy } from '../../plugins/rate-limit.js';
import { createVoiceService, type VoiceServiceConfig } from './voice.service.js';
import {
  stateForVoiceResponseSchema,
  voiceBudgetResponseSchema,
  voiceCheckpointSchema,
  voiceCheckpointResponseSchema,
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
      const result = await service.startCall({
        userId: request.user.sub,
        sessionId: request.params.id,
      });

      return {
        token: result.token,
        livekit_url: result.livekitUrl,
        room: result.room,
        call_id: result.callId,
        expires_at: result.expiresAt.toISOString(),
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  app.post(
    '/sessions/:id/voice/end',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimitPolicy.voiceEnd() },
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
        callId: request.body.call_id,
      });
      return {
        seconds_recorded: result.secondsRecorded,
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  app.get(
    '/internal/sessions/:id/state-for-voice',
    {
      config: { rateLimit: rateLimitPolicy.voiceInternal() },
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

  app.get(
    '/internal/sessions/:id/voice-budget',
    {
      config: { rateLimit: rateLimitPolicy.voiceInternal() },
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
        usage_date: budget.usageDate,
        reset_at: budget.resetAt.toISOString(),
      };
    },
  );

  app.post(
    '/internal/sessions/:id/voice/end',
    {
      config: { rateLimit: rateLimitPolicy.voiceInternal() },
      schema: {
        tags: ['voice'],
        summary: 'Internal: finalize call analysis (no duration debit)',
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
        callId: request.body.call_id,
        voiceAnalysis: request.body.voice_analysis,
      });
      return {
        seconds_recorded: result.secondsRecorded,
        quota_remaining_seconds: result.quotaRemainingSeconds,
      };
    },
  );

  app.post('/internal/voice/calls/:callId/checkpoint', {
    config: { rateLimit: { ...rateLimitPolicy.voiceInternal(), keyGenerator(request) {
      const params = request.params;
      const id = params && typeof params === 'object' && 'callId' in params ? params.callId : undefined;
      return typeof id === 'string' ? `vcall:${id}` : `ip:${request.ip}`;
    } } },
    schema: {
      tags: ['voice'], hide: true,
      params: z.object({ callId: z.uuid() }), body: voiceCheckpointSchema,
      response: { 200: voiceCheckpointResponseSchema },
    },
  }, async (request) => {
    assertInternalCaller(request.headers['x-internal-key']);
    const result = await service.checkpointCall({
      callId: request.params.callId, sequence: request.body.sequence,
      cumulativeSeconds: request.body.cumulative_seconds, ended: request.body.ended,
    });
    return {
      remaining_seconds: result.remainingSeconds, cap_seconds: result.capSeconds,
      usage_date: result.usageDate, reset_at: result.resetAt.toISOString(), continue_call: result.continueCall,
    };
  });

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
    const providedBuf = Buffer.from(typeof provided === 'string' ? provided : '', 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new HttpError(401, 'Internal key required', 'unauthorized');
    }
  }
};
