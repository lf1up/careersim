import type { AgentAvatarResponse, AgentClient } from '../../src/agent/client.js';
import { AgentRequestError } from '../../src/agent/client.js';
import type {
  AgentConversationResponse,
  AgentDebriefReport,
  AgentDebriefResponse,
  AgentMessage,
  AgentPersona,
  AgentPersonasResponse,
  AgentSimulation,
  AgentSimulationDetail,
  AgentSimulationsResponse,
  AgentStreamEvent,
  AgentWireState,
  ProactiveTrigger,
} from '../../src/agent/types.js';

/**
 * Conversation-style block the agent embeds in its wire state. The API uses
 * these fields to drive `session_config` on detail responses and the
 * persona-aware `/nudge` policy. Exposed from the test helper so individual
 * cases can override just the fields they care about.
 */
export interface FakeConversationStyle {
  startsConversation?: boolean | 'sometimes';
  typingSpeedWpm?: number;
  inactivityNudgeDelaySec?: { min: number; max: number };
  inactivityNudges?: { min: number; max: number };
  burstiness?: { min: number; max: number };
  [key: string]: unknown;
}

/**
 * Deterministic in-process stand-in for the Python agent's HTTP contract.
 *
 * Mirrors `_FakeGraph` in agent/tests/test_api.py:155 closely enough that the
 * API's statelessness tests can assert the exact same contract:
 *   - init:      seeds persona/simulation + an opener AI message
 *   - turn:      appends [HumanMessage, AIMessage('echo:<msg>')]
 *   - proactive: appends AIMessage('proactive:<trigger>')
 */
export class FakeAgent implements AgentClient {
  public callLog: string[] = [];

  constructor(
    public simulations: AgentSimulation[] = [
      {
        slug: 'behavioral-interview-brenda',
        title: 'Behavioral Interview',
        persona_name: 'Brenda',
        persona_slug: 'brenda',
        avatar_url: '/personas/brenda/avatar',
        description: 'Navigate a structured behavioral interview.',
        difficulty: 3,
        estimated_duration_minutes: 25,
        goal_count: 4,
        skills_to_learn: ['Interview techniques', 'Building rapport'],
        tags: ['interview', 'behavioral'],
      },
      {
        slug: 'tech-cultural-fit',
        title: 'Cultural Fit Chat',
        persona_name: 'Alex',
        persona_slug: 'alex',
        avatar_url: '/personas/alex/avatar',
        description: 'Impress a passionate tech lead.',
        difficulty: 2,
        estimated_duration_minutes: 20,
        goal_count: 3,
        skills_to_learn: ['Cultural fit', 'Technical discussion'],
        tags: ['interview', 'culture'],
      },
    ],
    public personas: AgentPersona[] = [
      {
        slug: 'brenda',
        name: 'Brenda',
        role: 'HR Manager',
        category: 'JOB_SEEKING',
        difficulty_level: 3,
        avatar_url: '/personas/brenda/avatar',
      },
      {
        slug: 'alex',
        name: 'Alex',
        role: 'Tech Lead',
        category: 'JOB_SEEKING',
        difficulty_level: 2,
        avatar_url: '/personas/alex/avatar',
      },
    ],
    /**
     * Default style declares a deterministic inactivity profile (min == max
     * for `inactivityNudgeDelaySec`, fixed `inactivityNudges.max`) so
     * guardrail tests can rewind the clock past a known threshold without
     * fighting the deterministic-hash pick. Cases that want to exercise
     * different cadences should pass their own ranges here.
     */
    public conversationStyle: FakeConversationStyle = {
      startsConversation: true,
      typingSpeedWpm: 120,
      inactivityNudgeDelaySec: { min: 60, max: 60 },
      inactivityNudges: { min: 0, max: 2 },
      burstiness: { min: 1, max: 2 },
    },
  ) {}

  async health() {
    this.callLog.push('health');
    return { status: 'ok' };
  }

  async listSimulations(): Promise<AgentSimulationsResponse> {
    this.callLog.push('listSimulations');
    return { simulations: this.simulations };
  }

  async getSimulation(slug: string): Promise<AgentSimulationDetail> {
    this.callLog.push(`getSimulation:${slug}`);
    const sim = this.simulations.find((s) => s.slug === slug);
    if (!sim) {
      throw new AgentRequestError(
        `agent GET /simulations/${slug} failed (404)`,
        404,
        JSON.stringify({ detail: `Simulation '${slug}' not found` }),
      );
    }
    return {
      slug: sim.slug,
      title: sim.title,
      description: sim.description ?? '',
      scenario: `Scenario for ${sim.title}.`,
      objectives: ['Objective A', 'Objective B'],
      persona_name: sim.persona_name,
      persona_slug: sim.persona_slug ?? null,
      avatar_url: sim.avatar_url ?? null,
      persona_role: 'HR Manager',
      persona_category: 'JOB_SEEKING',
      persona_difficulty_level: sim.difficulty ?? null,
      difficulty: sim.difficulty ?? null,
      estimated_duration_minutes: sim.estimated_duration_minutes ?? null,
      skills_to_learn: sim.skills_to_learn ?? [],
      tags: sim.tags ?? [],
      success_criteria: {
        communication: ['Clear responses'],
        problem_solving: ['Structured thinking'],
        emotional: ['Composure'],
      },
      conversation_goals: [
        {
          goal_number: 1,
          title: 'Opening',
          description: 'Greet the interviewer warmly.',
          key_behaviors: ['Say hello'],
          success_indicators: ['Warm reply'],
          is_optional: false,
        },
      ],
    };
  }

  async listPersonas(): Promise<AgentPersonasResponse> {
    this.callLog.push('listPersonas');
    return { personas: this.personas };
  }

  async getPersonaAvatar(args: {
    slug: string;
    signal?: AbortSignal;
  }): Promise<AgentAvatarResponse> {
    this.callLog.push(`getPersonaAvatar:${args.slug}`);
    if (!this.personas.some((p) => p.slug === args.slug)) {
      throw new AgentRequestError(
        `agent GET /personas/${args.slug}/avatar failed (404)`,
        404,
        JSON.stringify({ detail: `No avatar for persona '${args.slug}'` }),
      );
    }
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
      'hex',
    );
    return {
      headers: {
        'content-type': 'image/png',
        'content-length': String(pngBytes.length),
        'cache-control': 'public, max-age=86400',
      },
      body: (async function* stream() {
        yield pngBytes;
      })(),
    };
  }

  async initConversation(args: {
    simulationSlug: string;
    sessionId?: string;
  }): Promise<AgentConversationResponse> {
    this.callLog.push(`init:${args.simulationSlug}`);
    const sim = this.simulations.find((s) => s.slug === args.simulationSlug);
    if (!sim) {
      throw new Error(`Unknown simulation: ${args.simulationSlug}`);
    }
    const opener: AgentMessage = { role: 'ai', content: `hello from ${sim.persona_name}` };
    const state: AgentWireState = {
      session_id: args.sessionId,
      simulation: { slug: sim.slug, title: sim.title },
      persona: { name: sim.persona_name, conversationStyle: { ...this.conversationStyle } },
      messages: [opener],
      goal_progress: [],
      last_user_sentiment: null,
      last_user_emotion: null,
      last_ai_sentiment: null,
      last_ai_emotion: null,
    };
    return this.#buildResponse(state);
  }

  async turn(args: {
    state: AgentWireState;
    userMessages: string[];
  }): Promise<AgentConversationResponse> {
    const joined = args.userMessages.join('\n');
    this.callLog.push(`turn:${joined}`);
    const prior = args.state.messages ?? [];
    const nextMessages: AgentMessage[] = [
      ...prior,
      ...args.userMessages.map<AgentMessage>((m) => ({ role: 'human', content: m })),
      { role: 'ai', content: `echo:${joined}` },
    ];
    const newState: AgentWireState = { ...args.state, messages: nextMessages };
    return this.#buildResponse(newState);
  }

  async proactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
  }): Promise<AgentConversationResponse> {
    this.callLog.push(`proactive:${args.triggerType}`);
    const prior = args.state.messages ?? [];
    const nextMessages: AgentMessage[] = [
      ...prior,
      { role: 'ai', content: `proactive:${args.triggerType}` },
    ];
    return this.#buildResponse({ ...args.state, messages: nextMessages });
  }

  async debrief(args: { state: AgentWireState }): Promise<AgentDebriefResponse> {
    const messages = args.state.messages ?? [];
    this.callLog.push(`debrief:${messages.length}`);
    const userMessages = messages.filter((m) => m.role === 'human');
    const report: AgentDebriefReport = {
      version: 1,
      generated_at: new Date().toISOString(),
      overall_score: 74,
      skills: [
        { key: 'clarity', score: 72, rationale: 'Structured answers.' },
        { key: 'confidence', score: 65, rationale: 'Some hedging.' },
        { key: 'problem_solving', score: 80, rationale: 'Good examples.' },
        { key: 'emotional_intelligence', score: 70, rationale: 'Read cues well.' },
        { key: 'goal_outcome', score: 85, rationale: '1 of 1 required goals achieved.' },
      ],
      goal_outcome: {
        score: 85,
        total: 1,
        required: 1,
        achieved_required: 1,
        achieved_total: 1,
      },
      stats: {
        message_count: messages.length,
        user_message_count: userMessages.length,
        ai_message_count: messages.length - userMessages.length,
        user_word_count: userMessages.reduce(
          (sum, m) => sum + m.content.split(/\s+/).length,
          0,
        ),
        ai_word_count: 0,
      },
      emotional_tone: {
        overall: 'composed',
        journey: [
          { phase: 'Opening', tone: 'nervous', note: 'Slow start.' },
          { phase: 'Closing', tone: 'confident', note: 'Strong finish.' },
        ],
      },
      summary: 'A solid session overall.',
      strengths: ['Clear structure'],
      improvement_areas: ['Reduce hedging'],
      advice: ['Practice concise openers'],
      key_moments: [
        { message_index: 1, role: 'human', label: 'Strong greeting', note: 'Warm opener.' },
      ],
      voice: null,
    };
    return { report };
  }

  async *streamTurn(args: {
    state: AgentWireState;
    userMessages: string[];
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent> {
    const joined = args.userMessages.join('\n');
    this.callLog.push(`streamTurn:${joined}`);
    const prior = args.state.messages ?? [];
    const aiContent = `echo:${joined}`;
    const nextMessages: AgentMessage[] = [
      ...prior,
      ...args.userMessages.map<AgentMessage>((m) => ({ role: 'human', content: m })),
      { role: 'ai', content: aiContent },
    ];
    const newState: AgentWireState = { ...args.state, messages: nextMessages };

    yield {
      type: 'message',
      data: {
        content: aiContent,
        node: 'conversation',
        typing_delay_sec: 0.1,
        message_index: nextMessages.length - 1,
        is_followup: false,
        goal_progress: [],
        analysis: {},
      },
    };
    yield {
      type: 'done',
      data: {
        state: newState,
        messages: nextMessages,
        goal_progress: [],
      },
    };
  }

  async *streamProactive(args: {
    state: AgentWireState;
    triggerType: ProactiveTrigger;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent> {
    this.callLog.push(`streamProactive:${args.triggerType}`);
    const prior = args.state.messages ?? [];
    const aiContent = `proactive:${args.triggerType}`;
    const nextMessages: AgentMessage[] = [
      ...prior,
      { role: 'ai', content: aiContent },
    ];
    const newState: AgentWireState = { ...args.state, messages: nextMessages };

    yield {
      type: 'message',
      data: {
        content: aiContent,
        node: 'proactive',
        typing_delay_sec: 0.1,
        message_index: nextMessages.length - 1,
        is_followup: args.triggerType === 'followup',
        goal_progress: [],
        analysis: {},
      },
    };
    yield {
      type: 'done',
      data: {
        state: newState,
        messages: nextMessages,
        goal_progress: [],
      },
    };
  }

  #buildResponse(state: AgentWireState): AgentConversationResponse {
    return {
      state,
      messages: state.messages ?? [],
      goal_progress: state.goal_progress ?? [],
      analysis: {
        user_sentiment: state.last_user_sentiment ?? null,
        user_emotion: state.last_user_emotion ?? null,
        ai_sentiment: state.last_ai_sentiment ?? null,
        ai_emotion: state.last_ai_emotion ?? null,
      },
    };
  }
}
