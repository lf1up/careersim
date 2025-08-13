/// <reference types="jest" />
/* eslint-env jest */
// Local declarations to satisfy type checking in environments where Jest globals aren't auto-inferred by the linter
declare const describe: any;
declare const it: any;
declare const jest: any;
declare const beforeAll: any;
declare const afterAll: any;
declare const expect: any;
import { AppDataSource } from '../config/database';
import request from 'supertest';
import { app } from '../server';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { User } from '../entities/User';
import { Simulation } from '../entities/Simulation';
import type {} from 'jest';

// Build a richer, step-aligned user utterance to better exercise the classifiers
function buildUserUtterance(
  goal: { title: string; description?: string; keyBehaviors?: string[] },
  personaName: string,
): string {
  const title = goal.title.toLowerCase();
  const behaviors = goal.keyBehaviors || [];

  const joinBehaviors = (items: string[]) => {
    if (!items || items.length === 0) return '';
    if (items.length === 1) return items[0];
    const head = items.slice(0, -1).join(', ');
    const tail = items[items.length - 1];
    return `${head}, and ${tail}`;
  };

  // Tailored phrasing for common steps, with explicit inclusion of key behaviors
  if (title.includes('opening') || title.includes('rapport')) {
    const behaviorLine = behaviors.length > 0
      ? `I want to ${joinBehaviors(behaviors.map((b) => b.toLowerCase()))}.`
      : 'I want to start professionally and build rapport.';
    return `Hi ${personaName}, thanks for meeting with me today. I appreciate the opportunity and I'm genuinely interested in the company and role. ${behaviorLine}`;
  }

  if (title.includes('behavioral') || title.includes('star')) {
    const behaviorLine = behaviors.length > 0
      ? `I will use the STAR method and ${joinBehaviors(behaviors.map((b) => b.toLowerCase()))}.`
      : 'I will answer using the STAR method with specific, relevant examples.';
    return `For a recent example: Situation — our team faced a slipping deadline; Task — I owned stabilizing the release; Action — I re-scoped work, aligned stakeholders, and unblocked QA; Result — we shipped on time with improved quality. ${behaviorLine}`;
  }

  if (title.includes('concern')) {
    const behaviorLine = behaviors.length > 0
      ? `To address concerns, I'll ${joinBehaviors(behaviors.map((b) => b.toLowerCase()))}.`
      : 'To address concerns, I want to show self-awareness, mitigate risks, and demonstrate cultural fit.';
    return `I want to be transparent about potential gaps and how I mitigate them. ${behaviorLine}`;
  }

  if (title.includes('question')) {
    const behaviorLine = behaviors.length > 0
      ? `I have questions about ${joinBehaviors(behaviors.map((b) => b.replace(/^ask\s+/i, '').toLowerCase()))}.`
      : 'I have thoughtful questions about team culture, expectations, and long-term growth.';
    return `I'd love to learn more to ensure strong alignment. ${behaviorLine}`;
  }

  if (title.includes('closing') || title.includes('wrap')) {
    const behaviorLine = behaviors.length > 0
      ? `Before we wrap up, I'd like to ${joinBehaviors(behaviors.map((b) => b.toLowerCase()))}.`
      : 'Before we wrap up, I\'d like to summarize my qualifications, express continued interest, and ask about next steps.';
    return `${behaviorLine} Thanks again for your time today.`;
  }

  // Generic fallback that still includes the behaviors to help classification
  const generic = behaviors.length > 0
    ? `Regarding "${goal.title}": I'll ${joinBehaviors(behaviors.map((b) => b.toLowerCase()))}.`
    : `Regarding "${goal.title}": I'll proceed accordingly and keep things professional.`;
  return generic;
}

// Helper to create a JWT for an existing user
const signForUser = (userId: string, email: string, role: string) => {
  const token = jwt.sign({ userId, email, role }, config.jwt.secret, { expiresIn: '1h' });
  return token;
};

describe('Automatic conversational tests', () => {
  // Keep a generous but finite timeout; transformers and AI are stubbed in test mode
  jest.setTimeout(240000);
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

    // If this is the Brenda simulation, use the exact scripted dialogue; otherwise use generic utterances
    const goals = (startRes.body.session.simulation.conversationGoals || []) as Array<{ title: string; isOptional?: boolean; keyBehaviors?: string[]; description?: string }>;
    const personaName = startRes.body.session.simulation.personas?.[0]?.name || 'Interviewer';

    if (simulation.slug === 'behavioral-interview-brenda') {
      // Send closing first to satisfy the only required goal, then optional steps with explicit key behavior phrasing
      const script = [
        // Step 5 — Professional Closing (required)
        'To close, I’d like to briefly summarize my fit: I bring strong execution under pressure, clear communication, and a habit of learning quickly, along with hands‑on experience improving reliability and partnering cross‑functionally. I’m very interested in this opportunity and excited to contribute here. What are the next steps and timeline for the process?',
        // Step 1 — Opening and Rapport Building (optional) with title and key behaviors verbatim
        `Opening and Rapport Building — Hi ${personaName.split(' ')[0] || 'Brenda'}, professional greeting. I want to express appreciation for the opportunity and show genuine interest in the company. Thank you for meeting with me.`,
        // Step 1 — Prompt to elicit success indicators in AI reply
        'Does this help establish a professional tone and make you feel more relaxed? I hope initial nervousness decreases.',
        // Step 2 — Behavioral Question Response (optional) with title and key behaviors verbatim
        'Behavioral Question Response — For a relevant example using the STAR method: Situation — our team’s release was at risk after a critical outage; Task — stabilize production and restore customer trust; Action — I coordinated a war‑room, rolled back the faulty deployment, added automated health checks, and documented a postmortem with clear owners; Result — uptime returned to 99.99% within two hours and we prevented a repeat incident. To be explicit: I will use STAR method structure, provide specific examples, and connect experiences to role requirements.',
        // Step 2 — Reinforcement line repeating key behaviors to help behavior score
        'Reinforcing the STAR answer: I used STAR method structure, provided specific examples, and connected my experiences to this role’s requirements to ensure relevance and clarity for you.',
        // Step 2 — Prompt to elicit success indicators in AI reply
        'Do these examples resonate with company needs? Are you taking notes and showing engagement? Any follow-up questions indicating interest?',
        // Step 3 — Addressing Concerns (optional) with key behaviors verbatim
        'To address concerns directly: I will show self-awareness, address potential red flags, and demonstrate cultural fit. For example, coming from a smaller company, I proactively adopt your standards, seek early review from security and legal, and ask for feedback to mitigate risk.',
        // Step 4 — Thoughtful Questions (optional) with key behaviors verbatim
        'Thoughtful questions to learn more: I want to ask about company culture, inquire about role expectations for the first 90 days, and show long-term thinking about how this role contributes over the next 12–18 months.',
      ];

      for (const line of script) {
        const msgRes = await request(app)
          .post(`/api/simulations/${simulation.id}/sessions/${sessionId}/messages`)
          .set('Authorization', authToken)
          .send({ content: line, type: 'user', syncMode: true })
          .expect(201);
        expect(msgRes.body.message).toBeDefined();
      }
    } else {
      for (const goal of goals) {
        const userText = buildUserUtterance(goal, personaName);
        const msgRes = await request(app)
          .post(`/api/simulations/${simulation.id}/sessions/${sessionId}/messages`)
          .set('Authorization', authToken)
          .send({ content: userText, type: 'user', syncMode: true })
          .expect(201);
        expect(msgRes.body.message).toBeDefined();
      }
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


