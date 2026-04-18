import type { AgentClient } from '../../src/agent/client.js';
import type {
  AgentConversationResponse,
  AgentMessage,
  AgentPersona,
  AgentPersonasResponse,
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
    public simulations: Array<{ slug: string; title: string; persona_name: string }> = [
      { slug: 'behavioral-interview-brenda', title: 'Behavioral Interview', persona_name: 'Brenda' },
      { slug: 'tech-cultural-fit', title: 'Cultural Fit Chat', persona_name: 'Alex' },
    ],
    public personas: AgentPersona[] = [
      { slug: 'brenda', name: 'Brenda', role: 'HR Manager', category: 'JOB_SEEKING', difficulty_level: 3 },
      { slug: 'alex', name: 'Alex', role: 'Tech Lead', category: 'JOB_SEEKING', difficulty_level: 2 },
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

  async listPersonas(): Promise<AgentPersonasResponse> {
    this.callLog.push('listPersonas');
    return { personas: this.personas };
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
    userMessage: string;
  }): Promise<AgentConversationResponse> {
    this.callLog.push(`turn:${args.userMessage}`);
    const prior = args.state.messages ?? [];
    const nextMessages: AgentMessage[] = [
      ...prior,
      { role: 'human', content: args.userMessage },
      { role: 'ai', content: `echo:${args.userMessage}` },
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

  async *streamTurn(args: {
    state: AgentWireState;
    userMessage: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentStreamEvent> {
    this.callLog.push(`streamTurn:${args.userMessage}`);
    const prior = args.state.messages ?? [];
    const aiContent = `echo:${args.userMessage}`;
    const nextMessages: AgentMessage[] = [
      ...prior,
      { role: 'human', content: args.userMessage },
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
