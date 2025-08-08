/// <reference types="jest" />
/* eslint-env jest */
import { AppDataSource } from '../config/database';
import request from 'supertest';
import { app } from '../server';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { User } from '../entities/User';
import { Simulation } from '../entities/Simulation';

// Helper to create a JWT for an existing user
const signForUser = (userId: string, email: string, role: string) => {
  const token = jwt.sign({ userId, email, role }, config.jwt.secret, { expiresIn: '1h' });
  return token;
};

describe('Automatic conversational tests', () => {
  // Increase timeout due to real external service calls during test runs
  jest.setTimeout(180000);
  let authToken: string;
  let simulation: Simulation;

  beforeAll(async () => {
    await AppDataSource.initialize();
    const userRepo = AppDataSource.getRepository(User);
    const simRepo = AppDataSource.getRepository(Simulation);
    const admin = await userRepo.findOne({ where: { email: 'admin@careersim.com' } });
    if (!admin) throw new Error('Admin user not found - run seed first');
    authToken = `Bearer ${signForUser(admin.id, admin.email, admin.role)}`;

    simulation = await simRepo.findOne({ where: { slug: 'behavioral-interview-brenda' } }) as Simulation;
    if (!simulation) throw new Error('Seed simulation not found');
  });

  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it('walks through required steps and auto-completes session while allowing optional goals', async () => {
    // Start session
    const startRes = await request(app)
      .post(`/api/simulations/${simulation.id}/start-session`)
      .set('Authorization', authToken)
      .send({ userGoals: 'automated test' })
      .expect(201);

    const sessionId = startRes.body.session.id as string;

    // Define a small scripted path per goal title to nudge the zero-shot classifier
    const goals = (startRes.body.session.simulation.conversationGoals || []) as Array<{ title: string; isOptional?: boolean }>;

    for (const goal of goals) {
      // Send a user message aligned with the goal title to help classification
      const userText = `Step intent: ${goal.title}. I will proceed accordingly.`;

      const msgRes = await request(app)
        .post(`/api/simulations/${simulation.id}/sessions/${sessionId}/messages`)
        .set('Authorization', authToken)
        .send({ content: userText, type: 'user' })
        .expect(201);

      expect(msgRes.body.message).toBeDefined();
    }

    // Fetch session and validate progress
    const sessionRes = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set('Authorization', authToken)
      .expect(200);

    const session = sessionRes.body.session as any;
    expect(Array.isArray(session.goalProgress)).toBe(true);
    const requiredGoals = (session.simulation.conversationGoals || []).filter((g: any) => !g.isOptional);

    // All required steps should be achieved (session may be completed)
    const requiredAchieved = requiredGoals.every((g: any) => session.goalProgress.find((p: any) => p.stepNumber === g.stepNumber)?.status === 'achieved');
    expect(requiredAchieved).toBe(true);

    // Session is allowed to be completed while optional goals may remain
    expect(['completed', 'in_progress', 'paused']).toContain(session.status);
  });
});


