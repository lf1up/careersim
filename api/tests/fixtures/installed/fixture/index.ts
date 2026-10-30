import { fileURLToPath } from 'node:url';

import type { AgentSimulationDetail, AgentWireState } from '../../../../src/agent/types.js';
import { notFound, type ApiPlugin } from '../../../../src/extensions/sdk.js';

export const createdSessions: Array<{ slug: string; userId: string; sessionId: string }> = [];

function detail(slug: string): AgentSimulationDetail {
  return {
    slug,
    title: 'Fixture sim',
    description: 'A plugin-backed simulation',
    scenario: 'Practice the fixture conversation.',
    objectives: [],
    persona_name: 'Fixture',
    persona_slug: null,
    avatar_url: null,
    difficulty: 1,
    estimated_duration_minutes: 5,
    skills_to_learn: [],
    tags: [],
    success_criteria: { communication: [], problem_solving: [], emotional: [] },
    conversation_goals: [],
  };
}

const plugin: ApiPlugin = {
  id: 'fixture',
  apiVersion: 1,
  migrations: {
    folder: fileURLToPath(new URL('./migrations/', import.meta.url)),
    schema: 'extfix',
  },
  async routes(scope) {
    scope.get('/ping', async () => ({ ok: true }));
  },
  simulations: {
    namespace: 'fixture',
    async getDetail({ slug, userId }) {
      if (slug === 'fixture:private' && !userId) return null;
      if (slug !== 'fixture:open' && slug !== 'fixture:private') return null;
      return detail(slug);
    },
    async prepareSession({ slug }) {
      if (slug !== 'fixture:open') throw notFound(`Simulation "${slug}" was not found`);
      const state: AgentWireState = {
        simulation: { slug, title: 'Fixture sim' },
        persona: { name: 'Fixture' },
        messages: [],
        goal_progress: [],
        proactive_trigger: 'start',
      };
      return { state };
    },
    async onSessionCreated({ slug, userId, sessionId }) {
      createdSessions.push({ slug, userId, sessionId });
    },
  },
};

export default plugin;
