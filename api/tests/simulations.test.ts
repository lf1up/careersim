import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestApp,
  registerAndAuth,
  type TestHarness,
} from './helpers/build-test-app.js';

describe('GET /simulations', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('requires auth', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/simulations' });
    expect(res.statusCode).toBe(401);
  });

  it('proxies the agent response with summary metadata', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/simulations',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.simulations)).toBe(true);
    expect(body.simulations[0]).toMatchObject({
      slug: expect.any(String),
      title: expect.any(String),
      persona_name: expect.any(String),
      description: expect.any(String),
      difficulty: expect.any(Number),
      estimated_duration_minutes: expect.any(Number),
      goal_count: expect.any(Number),
      skills_to_learn: expect.any(Array),
      tags: expect.any(Array),
    });
    expect(h.agent.callLog).toContain('listSimulations');
  });
});

describe('GET /simulations/:slug', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await buildTestApp();
  });
  afterEach(async () => {
    await h.close();
  });

  it('requires auth', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/simulations/behavioral-interview-brenda',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns full detail when the simulation exists', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/simulations/behavioral-interview-brenda',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      slug: 'behavioral-interview-brenda',
      title: expect.any(String),
      description: expect.any(String),
      scenario: expect.any(String),
      persona_name: expect.any(String),
      objectives: expect.any(Array),
      skills_to_learn: expect.any(Array),
      tags: expect.any(Array),
      success_criteria: {
        communication: expect.any(Array),
        problem_solving: expect.any(Array),
        emotional: expect.any(Array),
      },
      conversation_goals: expect.any(Array),
    });
    expect(body.conversation_goals[0]).toMatchObject({
      goal_number: expect.any(Number),
      title: expect.any(String),
      description: expect.any(String),
      key_behaviors: expect.any(Array),
      success_indicators: expect.any(Array),
      is_optional: expect.any(Boolean),
    });
    expect(h.agent.callLog).toContain(
      'getSimulation:behavioral-interview-brenda',
    );
  });

  it('returns 404 when the agent reports the simulation is missing', async () => {
    const { authHeader } = await registerAndAuth(h.app);
    const res = await h.app.inject({
      method: 'GET',
      url: '/simulations/does-not-exist',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: 'simulation_not_found',
      message: expect.stringContaining('does-not-exist'),
    });
  });
});
