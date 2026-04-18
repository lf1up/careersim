#!/usr/bin/env tsx
/**
 * Interactive end-to-end API flow tester.
 *
 * Walks through the full user journey (register → login → list sims → create
 * session → interactive REPL). The idea is to faithfully emulate a real
 * client: the server holds all the timing knowledge (persona config + env
 * guardrails), the script just polls `/nudge` on a fast tick and prints
 * whatever the server decides. That way the REPL behaves exactly like the
 * Gradio dev UI — inactivity fires after the persona's `inactivityNudgeDelaySec`
 * elapses, followups come back as a second `AI` message when the persona's
 * `burstiness` rolls true, and `session_config` on GET shows the picked
 * profile.
 *
 * REPL commands:
 *   free text       → POST /sessions/:id/messages/stream (SSE)
 *   /followup       → POST /sessions/:id/proactive/stream (SSE)
 *   /nudge          → POST /sessions/:id/nudge           (batch, guarded)
 *   /idle <sec>     → sleep N seconds, then /nudge
 *   /get            → GET  /sessions/:id (shows session_config too)
 *   /list           → GET  /sessions
 *   /help, /quit
 *
 * Usage:
 *   pnpm e2e
 *   pnpm e2e --email me@example.com --password supersecret
 *   BASE_URL=http://localhost:8000 pnpm e2e --simulation my-sim-slug
 *
 * Env:
 *   BASE_URL               (default http://localhost:8000)
 *   AUTO_NUDGE_SECONDS     (default 5; set 0 to disable the idle auto-nudger.
 *                           With a fast tick, the server — not the script —
 *                           decides when to fire based on persona config.)
 */

import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

// ---------------------------------------------------------------------------
// tiny ANSI palette (no deps — this script is intentionally zero-dep beyond
// Node's standard library and the runtime already in devDependencies: tsx)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
const c = (color: keyof typeof ANSI, s: string) => `${ANSI[color]}${s}${ANSI.reset}`;
const log = {
  info: (s: string) => console.log(c('cyan', '•'), s),
  ok: (s: string) => console.log(c('green', '✓'), s),
  warn: (s: string) => console.log(c('yellow', '!'), s),
  err: (s: string) => console.log(c('red', '✗'), s),
  step: (s: string) => console.log(`\n${c('bold', c('magenta', `── ${s} ──`))}`),
  dim: (s: string) => console.log(c('gray', s)),
};

// ---------------------------------------------------------------------------
// argv / env
// ---------------------------------------------------------------------------

interface CliArgs {
  email?: string;
  password?: string;
  simulation?: string;
  baseUrl: string;
  autoNudgeSec: number;
  skipHealth: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const read = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  return {
    email: read('--email'),
    password: read('--password'),
    simulation: read('--simulation') ?? read('--slug'),
    baseUrl: (process.env.BASE_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    // Fast default tick — the server decides when to actually fire based on
    // persona config; polling often is cheap and mirrors Gradio's 5s timer.
    autoNudgeSec: Number(process.env.AUTO_NUDGE_SECONDS ?? '5'),
    skipHealth: argv.includes('--skip-health'),
  };
}

// ---------------------------------------------------------------------------
// thin HTTP client
// ---------------------------------------------------------------------------

interface ApiClient {
  baseUrl: string;
  token: string | null;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

async function call<T = unknown>(
  client: ApiClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (client.token) headers.authorization = `Bearer ${client.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${client.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      parsed ?? text,
      `${method} ${path} → ${res.status} ${res.statusText}`,
    );
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

type SseEvent = { event: string; data: unknown };

/**
 * Minimal line-based SSE parser. The API emits `event: <name>\ndata: <json>\n\n`
 * frames — the Fastify proxy serialises them verbatim from the agent.
 */
async function* streamSse(
  client: ApiClient,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  if (client.token) headers.authorization = `Bearer ${client.token}`;

  const res = await fetch(`${client.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, safeJson(text), `POST ${path} → ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const frame = parseSseFrame(rawFrame);
        if (frame) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  return { event, data: safeJson(dataStr) };
}

// ---------------------------------------------------------------------------
// API typings (subset — matches api/src/modules/**/*.schema.ts)
// ---------------------------------------------------------------------------

interface AuthResponse {
  token: string;
  user: { id: string; email: string };
}
interface SimulationsResponse {
  simulations: Array<{ slug: string; title: string; persona_name: string }>;
}
interface Message {
  id: string;
  role: 'human' | 'ai';
  content: string;
  order_index: number;
  typing_delay_ms: number | null;
  created_at: string;
}
interface Range {
  min: number;
  max: number;
}
interface SessionConfig {
  starts_conversation: boolean | null;
  typing_speed_wpm: number | null;
  inactivity_nudge_delay_sec: Range | null;
  max_inactivity_nudges: number | null;
  burstiness: Range | null;
}
interface SessionDetail {
  id: string;
  simulation_slug: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  goal_progress: Array<Record<string, unknown>>;
  analysis: Record<string, unknown>;
  session_config: SessionConfig;
}
type NudgeSkipReason =
  | 'no_human_activity'
  | 'not_enough_idle'
  | 'budget_exhausted'
  | 'nudges_disabled'
  | 'agent_silent';
type NudgeResponse =
  | { nudged: true; session: SessionDetail }
  | {
      nudged: false;
      reason: NudgeSkipReason;
      idle_seconds: number;
      nudge_count: number;
    };

// ---------------------------------------------------------------------------
// flow helpers
// ---------------------------------------------------------------------------

async function registerOrLogin(
  client: ApiClient,
  email: string,
  password: string,
): Promise<AuthResponse> {
  try {
    const res = await call<AuthResponse>(client, 'POST', '/auth/register', { email, password });
    log.ok(`registered ${c('bold', email)}`);
    return res;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 409 || err.status === 400)) {
      log.warn(`register failed (${err.status}) — trying login instead`);
      const res = await call<AuthResponse>(client, 'POST', '/auth/login', { email, password });
      log.ok(`logged in as ${c('bold', email)}`);
      return res;
    }
    throw err;
  }
}

function formatRange(r: Range | null): string {
  if (!r) return c('gray', 'n/a');
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

/**
 * Render the persona-derived timing profile surfaced by the API. Mirrors
 * what `conversationStyle` looks like in the Gradio dev UI, so you can see
 * at a glance why a given session fires nudges when it does.
 */
function printSessionConfig(cfg: SessionConfig): void {
  const starts =
    cfg.starts_conversation === null
      ? c('gray', 'n/a')
      : cfg.starts_conversation
      ? c('green', 'yes')
      : c('yellow', 'no');
  const wpm = cfg.typing_speed_wpm ?? c('gray', 'n/a');
  const delay = formatRange(cfg.inactivity_nudge_delay_sec);
  const maxNudges = cfg.max_inactivity_nudges ?? c('gray', 'n/a');
  const burst = formatRange(cfg.burstiness);

  console.log(
    c('gray', '  persona config:'),
    [
      `starts=${starts}`,
      `typing=${wpm} wpm`,
      `nudge_delay=${delay}s`,
      `max_nudges=${maxNudges}`,
      `burstiness=${burst}`,
    ].join(c('gray', ', ')),
  );
}

function printMessages(messages: Message[], fromIndex = 0): void {
  for (let i = fromIndex; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    const tag =
      m.role === 'ai' ? c('green', 'AI  ') : c('blue', 'YOU ');
    const delay = m.typing_delay_ms != null ? c('gray', ` [${m.typing_delay_ms}ms]`) : '';
    console.log(`${tag} ${m.content}${delay}`);
  }
}

function printStreamMessage(payload: unknown): void {
  const data = payload as {
    content?: string;
    typing_delay_sec?: number;
    node?: string;
    is_followup?: boolean;
    message_index?: number;
  };
  const delay =
    typeof data.typing_delay_sec === 'number'
      ? c('gray', ` [Δ ${data.typing_delay_sec.toFixed(2)}s, node=${data.node ?? '?'}]`)
      : '';
  const prefix = data.is_followup ? c('magenta', 'AI* ') : c('green', 'AI  ');
  console.log(`${prefix} ${data.content ?? ''}${delay}`);
}

/**
 * Run an SSE turn (or followup) with cosmetic typing-delay playback so the
 * streamed messages feel like the real app instead of a wall of text.
 */
async function runStream(
  client: ApiClient,
  path: string,
  body: unknown,
): Promise<SessionDetail | null> {
  let lastState: SessionDetail | null = null;
  let prevDelaySec = 0;
  for await (const evt of streamSse(client, path, body)) {
    if (evt.event === 'message') {
      const data = evt.data as { typing_delay_sec?: number };
      const wait = Math.min(Number(data.typing_delay_sec ?? 0), 5); // clamp for UX
      if (wait > prevDelaySec) await sleep((wait - prevDelaySec) * 1000);
      prevDelaySec = wait;
      printStreamMessage(evt.data);
    } else if (evt.event === 'done') {
      const d = evt.data as { session?: SessionDetail };
      lastState = d.session ?? null;
    } else if (evt.event === 'error') {
      log.err(`stream error: ${JSON.stringify(evt.data)}`);
    }
  }
  return lastState;
}

// ---------------------------------------------------------------------------
// auto-nudger: fires periodically while the user is idle at the prompt
// ---------------------------------------------------------------------------

interface AutoNudger {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
}

/**
 * Callback bundle the auto-nudger uses to hand successful fires (and
 * guardrail skips) back to the REPL. The REPL owns `lastKnownCount`, so we
 * let it compute the message delta — avoids the bug where an internal
 * counter started at zero and the first successful fire replayed the whole
 * history.
 */
interface AutoNudgerHandlers {
  onFire: (session: SessionDetail) => void;
  onSkip: (reason: string, idleSeconds: number, nudgeCount: number) => void;
  onError: (err: unknown) => void;
}

function createAutoNudger(
  client: ApiClient,
  sessionId: string,
  everySec: number,
  handlers: AutoNudgerHandlers,
): AutoNudger {
  if (everySec <= 0) {
    return { start() {}, stop() {}, pause() {}, resume() {} };
  }

  let timer: NodeJS.Timeout | null = null;
  let paused = false;

  const tick = async () => {
    if (paused) return;
    try {
      // No request body: the server's decision comes straight from the
      // persona's `conversationStyle`, mirroring the Gradio dev UI.
      const res = await call<NudgeResponse>(
        client,
        'POST',
        `/sessions/${sessionId}/nudge`,
        {},
      );
      process.stdout.write('\r\x1b[2K');
      if (res.nudged) {
        handlers.onFire(res.session);
      } else {
        handlers.onSkip(res.reason, res.idle_seconds, res.nudge_count);
        // Persona has no nudge config at all → stop polling. Further ticks
        // would just spam the same skip reason until the session ends.
        if (res.reason === 'nudges_disabled') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      }
      process.stdout.write(c('cyan', 'you> '));
    } catch (err) {
      process.stdout.write('\r\x1b[2K');
      handlers.onError(err);
      process.stdout.write(c('cyan', 'you> '));
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), everySec * 1000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const client: ApiClient = { baseUrl: args.baseUrl, token: null };

  log.info(`base URL: ${c('bold', client.baseUrl)}`);

  // 1. health --------------------------------------------------------------
  if (!args.skipHealth) {
    log.step('health');
    try {
      const h = await call<unknown>(client, 'GET', '/health');
      log.ok(`health: ${JSON.stringify(h)}`);
    } catch (err) {
      log.err(`health failed: ${err instanceof Error ? err.message : String(err)}`);
      log.warn('continuing anyway (use --skip-health to silence this check)');
    }
  }

  // 2. register / login ---------------------------------------------------
  log.step('auth');
  const email = args.email ?? `e2e+${randomBytes(4).toString('hex')}@careersim.test`;
  const password = args.password ?? 'correct-horse-battery-staple';
  log.dim(`  email=${email}  password=${password}`);
  const auth = await registerOrLogin(client, email, password);
  client.token = auth.token;
  log.ok(`user id = ${auth.user.id}`);
  log.dim(`  token = ${auth.token.slice(0, 18)}…`);

  // 3. me -----------------------------------------------------------------
  const me = await call<{ id: string; email: string }>(client, 'GET', '/auth/me');
  log.ok(`/auth/me → ${me.email}`);

  // 4. simulations --------------------------------------------------------
  log.step('simulations');
  const sims = await call<SimulationsResponse>(client, 'GET', '/simulations');
  if (sims.simulations.length === 0) {
    log.err('no simulations returned from the agent — is it running and seeded?');
    process.exit(1);
  }
  sims.simulations.forEach((s, i) => {
    console.log(
      `  ${c('bold', String(i + 1).padStart(2))}. ${c('cyan', s.slug)}  ${c('gray', '—')} ${s.title}  ${c('gray', `(persona: ${s.persona_name})`)}`,
    );
  });

  // 5. pick + create session ----------------------------------------------
  const rl = readline.createInterface({ input, output });
  let chosen = args.simulation
    ? sims.simulations.find((s) => s.slug === args.simulation)
    : undefined;

  if (!chosen) {
    const answer = (
      await rl.question(
        c('cyan', `\nPick a simulation [1-${sims.simulations.length}, default 1]: `),
      )
    ).trim();
    const idx = answer ? Number(answer) - 1 : 0;
    chosen = sims.simulations[idx] ?? sims.simulations[0];
  }
  if (!chosen) {
    log.err('no simulation selected');
    process.exit(1);
  }
  log.ok(`selected ${c('bold', chosen.slug)} — ${chosen.title}`);

  log.step('create session');
  const session = await call<SessionDetail>(client, 'POST', '/sessions', {
    simulation_slug: chosen.slug,
  });
  log.ok(`session id = ${session.id}  (${session.messages.length} opening msg${session.messages.length === 1 ? '' : 's'})`);
  printSessionConfig(session.session_config);
  printMessages(session.messages);

  let lastKnownCount = session.messages.length;

  // 6. interactive REPL ---------------------------------------------------
  log.step('chat REPL');
  console.log(
    c(
      'gray',
      [
        'Commands:',
        '  /followup             — ask the agent to voluntarily say more (SSE)',
        '  /nudge                — try an inactivity nudge (server decides)',
        '  /idle <seconds>       — sleep N seconds, then try /nudge',
        '  /get                  — reload session detail + persona config',
        '  /list                 — list all your sessions',
        '  /help                 — show this help',
        '  /quit                 — exit',
        `Auto-nudge: poll every ${args.autoNudgeSec}s while idle; the server fires based on persona config.`,
      ].join('\n'),
    ),
  );

  const nudger = createAutoNudger(client, session.id, args.autoNudgeSec, {
    onFire(detail) {
      const newOnes = detail.messages.slice(lastKnownCount);
      if (newOnes.length === 0) {
        // Server counted the nudge against the budget but the agent produced
        // no proactive message — rare, but worth surfacing so the log stays
        // honest instead of printing "fired" with no content.
        log.dim('  (auto-nudge fired, but agent produced no new content)');
        return;
      }
      log.info(
        c(
          'magenta',
          `inactivity nudge fired (+${newOnes.length} msg${newOnes.length === 1 ? '' : 's'}, ${detail.messages.length} total)`,
        ),
      );
      printMessages(newOnes);
      lastKnownCount = detail.messages.length;
    },
    onSkip(reason, idle, count) {
      log.dim(`  (auto-nudge skipped: ${reason}, idle=${idle}s, count=${count})`);
    },
    onError(err) {
      log.err(`auto-nudge failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  nudger.start();

  const reload = async () => {
    const latest = await call<SessionDetail>(client, 'GET', `/sessions/${session.id}`);
    printSessionConfig(latest.session_config);
    if (latest.messages.length > lastKnownCount) {
      printMessages(latest.messages, lastKnownCount);
      lastKnownCount = latest.messages.length;
    }
    return latest;
  };

  try {
    while (true) {
      let line: string;
      try {
        line = (await rl.question(c('cyan', 'you> '))).trim();
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ERR_USE_AFTER_CLOSE') {
          log.dim('  (stdin closed — exiting REPL)');
          break;
        }
        throw err;
      }
      if (!line) continue;

      nudger.pause();

      if (line === '/quit' || line === '/exit') break;

      if (line === '/help') {
        console.log(
          c(
            'gray',
            'Commands: /followup, /nudge, /idle <sec>, /get, /list, /help, /quit',
          ),
        );
        nudger.resume();
        continue;
      }

      if (line === '/get') {
        await reload();
        nudger.resume();
        continue;
      }

      if (line === '/list') {
        const res = await call<{ sessions: unknown[] }>(client, 'GET', '/sessions');
        console.log(JSON.stringify(res.sessions, null, 2));
        nudger.resume();
        continue;
      }

      if (line.startsWith('/nudge')) {
        const res = await call<NudgeResponse>(
          client,
          'POST',
          `/sessions/${session.id}/nudge`,
          {},
        );
        if (res.nudged) {
          log.ok('nudge dispatched');
          printMessages(res.session.messages, lastKnownCount);
          lastKnownCount = res.session.messages.length;
        } else {
          log.warn(
            `nudge skipped: ${res.reason}  (idle=${res.idle_seconds}s, count=${res.nudge_count})`,
          );
        }
        nudger.resume();
        continue;
      }

      if (line.startsWith('/idle')) {
        const [, arg] = line.split(/\s+/);
        const seconds = Math.max(1, Number(arg) || 30);
        log.dim(`  sleeping for ${seconds}s…`);
        await sleep(seconds * 1000);
        const res = await call<NudgeResponse>(client, 'POST', `/sessions/${session.id}/nudge`, {});
        if (res.nudged) {
          log.ok(`nudged after ${seconds}s idle`);
          printMessages(res.session.messages, lastKnownCount);
          lastKnownCount = res.session.messages.length;
        } else {
          log.warn(`still skipped: ${res.reason}  (idle=${res.idle_seconds}s)`);
        }
        nudger.resume();
        continue;
      }

      if (line === '/followup') {
        log.dim('  streaming followup…');
        const updated = await runStream(client, `/sessions/${session.id}/proactive/stream`, {
          trigger_type: 'followup',
        });
        if (updated) lastKnownCount = updated.messages.length;
        nudger.resume();
        continue;
      }

      if (line.startsWith('/')) {
        log.warn(`unknown command: ${line}. Type /help for options.`);
        nudger.resume();
        continue;
      }

      // regular user message → streaming turn
      console.log(`${c('blue', 'YOU ')} ${line}`);
      const updated = await runStream(client, `/sessions/${session.id}/messages/stream`, {
        content: line,
      });
      if (updated) lastKnownCount = updated.messages.length;
      nudger.resume();
    }
  } finally {
    nudger.stop();
    rl.close();
  }

  log.step('done');
  log.ok('goodbye');
}

main().catch((err) => {
  if (err instanceof ApiError) {
    log.err(`${err.message}`);
    console.error(err.body);
  } else {
    log.err(err instanceof Error ? err.stack ?? err.message : String(err));
  }
  process.exit(1);
});
