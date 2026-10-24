import { afterEach, describe, expect, it } from 'vitest';
import type { AgentConversationResponse, AgentStreamEvent, AgentWireState } from '../src/agent/types.js';
import { buildTestApp, registerAndAuth, type TestHarness } from './helpers/build-test-app.js';
import { FakeAgent } from './helpers/fake-agent.js';

class CastAgent extends FakeAgent {
  override async initConversation(args: { simulationSlug: string; sessionId?: string }): Promise<AgentConversationResponse> {
    const response = await super.initConversation(args);
    response.state.characters = {
      lead: { persona: { slug: 'alex', name: 'Alex', role: 'Lead', hiddenMotivation: 'PRIVATE_SECRET' } },
      hr: { persona: { slug: 'brenda', name: 'Brenda', role: 'HR' }, privateKnowledge: 'PRIVATE_SECRET' },
    };
    response.state.messages = [];
    response.messages = [];
    return response;
  }
  override async *streamTurn(args: { state: AgentWireState; userMessages: string[]; signal?: AbortSignal }): AsyncIterable<AgentStreamEvent> {
    let state = { ...args.state, messages: [...(args.state.messages ?? []), { role: 'human' as const, content: args.userMessages[0]! }] };
    for (const [actor_id, actor_name, content, event_id] of [
      ['lead', 'Alex', 'Ship it', '11111111-1111-4111-8111-111111111111'],
      ['hr', 'Brenda', 'We need staff', '22222222-2222-4222-8222-222222222222'],
    ]) {
      const message = { role: 'ai' as const, actor_id, actor_name, content: content!, event_id };
      state = { ...state, messages: [...state.messages, message] };
      const data = { ...message, typing_delay_sec: 0, state, unexpected_private_field: 'PRIVATE_SECRET' };
      yield { type: 'message', data };
    }
    Object.assign(state, { needs_evaluation: true, evaluation_complete: false });
    yield { type: 'done', data: { state, messages: state.messages, goal_progress: [] } };
  }
}

let h: TestHarness;
afterEach(async () => { await h?.close(); });
async function setup(agent = new CastAgent()) {
  h = await buildTestApp({ agent, voice: { enabled: true } });
  const { authHeader } = await registerAndAuth(h.app);
  const session = (await h.app.inject({ method: 'POST', url: '/v1/sessions', headers: authHeader,
    payload: { simulation_slug: 'behavioral-interview-brenda' } })).json();
  return { authHeader, session };
}

describe('multi-character public contract', () => {
  it('persists speaker identity and exposes only public state during streaming and reload', async () => {
    const { authHeader, session } = await setup();
    expect(JSON.stringify(session)).not.toContain('PRIVATE_SECRET');
    const streamed = await h.app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/messages/stream`, headers: authHeader, payload: { content: 'Discuss' } });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).not.toContain('PRIVATE_SECRET');
    expect(streamed.body).not.toContain('"state":');
    const detail = (await h.app.inject({ url: `/v1/sessions/${session.id}`, headers: authHeader })).json();
    expect(detail.evaluation_pending).toBe(true);
    expect(detail.participants).toEqual(expect.arrayContaining([
      { actor_id: 'lead', name: 'Alex', persona_slug: 'alex', role: 'Lead' },
      { actor_id: 'hr', name: 'Brenda', persona_slug: 'brenda', role: 'HR' },
    ]));
    expect(detail.messages.slice(-2)).toEqual([
      expect.objectContaining({ actor_id: 'lead', actor_name: 'Alex', event_id: '11111111-1111-4111-8111-111111111111' }),
      expect.objectContaining({ actor_id: 'hr', actor_name: 'Brenda', event_id: '22222222-2222-4222-8222-222222222222' }),
    ]);
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_SECRET');
  });
  it('provides public actor fallbacks when restored persona details are missing', async () => {
    class SparseCastAgent extends CastAgent {
      override async initConversation(args: { simulationSlug: string; sessionId?: string }) {
        const response = await super.initConversation(args);
        response.state.characters!.hr!.persona = {};
        return response;
      }
    }
    const { authHeader, session } = await setup(new SparseCastAgent());
    const response = await h.app.inject({ url: `/v1/sessions/${session.id}`, headers: authHeader });
    expect(response.statusCode).toBe(200);
    expect(response.json().participants).toContainEqual({
      actor_id: 'hr', name: 'hr', persona_slug: '', role: '',
    });
    expect(JSON.stringify(response.json())).not.toContain('PRIVATE_SECRET');
  });
  it('disables group nudges and rejects voice and explicit followups', async () => {
    const { authHeader, session } = await setup();
    const nudge = await h.app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/nudge`, headers: authHeader });
    expect(nudge.json()).toMatchObject({ nudged: false, reason: 'nudges_disabled' });
    for (const [suffix, payload] of [
      ['voice/start', {}], ['messages/stream', { content: 'Hello', source: 'voice' }],
      ['proactive/stream', { trigger_type: 'followup' }],
      ['proactive', { trigger_type: 'followup' }],
    ] as const) {
      const response = await h.app.inject({ method: 'POST', url: `/v1/sessions/${session.id}/${suffix}`, headers: authHeader, payload });
      expect(response.statusCode, suffix).toBe(400);
    }
  });
});
