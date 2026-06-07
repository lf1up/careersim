# Voice Mode — Operator Guide

Single-source-of-truth doc for **voice mode**, now shipped on `main`.
Covers how to enable/disable voice mode, what services run, and a manual
smoke-test checklist to re-run before a release or after any change that
touches the voice path (worker, providers, LiveKit, or the `/voice/*`
routes).

> Voice mode landed via `feat/voice-mode`. This doc has outlived the
> merge — treat the checklist below as an acceptance / regression suite,
> not a one-time merge gate.

## Architecture in 30 seconds

```
┌────────┐   WebRTC   ┌──────────┐   PCM    ┌─────────────┐
│  web   │ ─────────► │ LiveKit  │ ───────► │ agent-voice │
│ (next) │            │   SFU    │ ◄─────── │   worker    │
└────────┘            └──────────┘   PCM    └──────┬──────┘
     ▲ HTTPS (start/end)                           │ HTTP (state-for-voice,
     │                                             │       messages, voice/end)
     ▼                                             ▼
┌─────────────────┐                          ┌──────────┐
│ api (Fastify)   │ ◄──────────────────────  │ api      │
│ /voice/*        │                          │ internal │
└─────────────────┘                          └──────────┘
```

* **`web`** mints the LiveKit token via `POST /sessions/:id/voice/start`
  and joins the SFU as a publisher/subscriber.
* **`livekit`** (Docker container, dev mode) routes audio between the
  user and the agent worker.
* **`agent-voice`** is a separate process (`python -m
  careersim_agent.main --serve voice`) that joins the same room, runs
  STT → LangGraph → TTS, and posts user messages back through the
  public API on the user's bearer token.
* **`api`** owns ownership checks and the daily quota. The quota debit
  is authoritative from the worker via the internal end route
  (`POST /internal/sessions/:id/voice/end`), using a server-side clock
  the browser can't influence; the user-facing `voice/end` only marks
  the call ended (clearing the single-active-call guard). Voice
  analytics are merged into `state_snapshot.analysis.voice` on that
  internal end.

### Daily-budget enforcement (authoritative)

`VOICE_DAILY_MINUTES_PER_USER` (default **60**) is a true per-user
per-day ceiling, not just a start gate:

* At call start the worker reads the owner's remaining budget from
  `GET /internal/sessions/:id/voice-budget` and arms a watchdog.
* ~60s before the budget is spent it publishes a `quota_warning`
  control event (web client shows a banner) and a brief spoken
  heads-up; at zero it publishes `quota_exhausted` and disconnects the
  room. The client renders "Daily N-minute voice limit reached" using
  the `cap_seconds` carried in the event.
* `VOICE_ACTIVE_CALL_STALE_SECONDS` backs a single-active-call guard at
  start (`409 voice_call_in_progress`) so a user can't open N tabs and
  run N concurrent calls past the cap. An un-ended call row older than
  this window is treated as a crashed worker so the user isn't locked
  out; `0` disables the guard.
* The minted LiveKit token TTL defaults to `cap + 10 min`, so the
  token always outlives the longest possible call and the watchdog
  (not token expiry) is what ends a maxed-out call.

## Kill switches (no rebuild required)

Setting `VOICE_ENABLED=false` in **either** the `api` or the
`agent-voice` env disables voice end-to-end:

* `api` returns `503 voice_disabled` from every `/voice/*` route.
* `agent-voice` exits 0 cleanly so docker-compose's restart policy
  doesn't loop.
* `web` reads `NEXT_PUBLIC_VOICE_ENABLED=false` and hides the call
  button.

You only need to flip **one** of these to turn the feature off; flipping
all three is the cleanest revert if you want to remove the UI affordance
on top of disabling the backend.

## Provider selection

The defaults are self-hosted:

| Layer | Default       | Cloud option(s)                    |
|-------|---------------|------------------------------------|
| STT   | `whisper_local` (`faster-whisper`) | `whisper_openai`, `deepgram` |
| TTS   | `piper_local` | `openai_tts`, `elevenlabs`         |

Switch globally via env (`VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`).
Personas can override the TTS provider via
`persona.voice.providerOverride`; see `agent/data/personas.json` for
the per-persona voice blocks.

## Smoke checklist

Run through this list **before a release** and **after any change that
touches the voice path**. Each step should leave a green check (or a
documented reason for skipping).

### A. Cold-start with all defaults

- [ ] `docker compose -f docker-compose.local.yml up --build` starts
      `livekit`, `agent`, `agent-voice`, `api`, `web`, `postgres`,
      `redis` cleanly. No restart loops in the first 60 seconds.
- [ ] `docker compose logs agent-voice | head -20` shows
      "voice enabled" and the worker registered with LiveKit.
- [ ] `curl -fsS http://localhost:7880` returns the LiveKit health page.

### B. Token mint + ownership

- [ ] `POST /sessions/:id/voice/start` (with valid bearer) returns
      `200` with a non-empty `token`, `livekit_url`, `room`, and a
      `quota_remaining_seconds` consistent with `VOICE_DAILY_MINUTES_PER_USER`.
- [ ] `POST /sessions/:id/voice/start` from a *different* user's bearer
      returns `403`.
- [ ] `POST /sessions/:id/voice/start` for an unknown session returns
      `404`.

### C. Kill-switch

- [ ] Restart api with `VOICE_ENABLED=false` →
      `POST /sessions/:id/voice/start` returns `503 voice_disabled`.
- [ ] Same env on agent-voice → the container exits 0 once and stays
      stopped (docker-compose `restart: on-failure` doesn't loop).
- [ ] `web` with `NEXT_PUBLIC_VOICE_ENABLED=false` does **not** render
      the "Call" button on `/sessions/:id`.

### D. End-to-end call against Vikram

1. Open `http://localhost:3000/sessions/<a fresh session for
   `vikram-shah-pipeline-recruiter`>`.
2. Click the **Call** button.
3. Browser asks for mic permission → grant.
4. Vikram should speak first ("Hey! Saw your profile...") within ~2s.
5. Speak: "What's the level for this role?"
6. Vikram replies; the **caption strip** updates in <1.5s of his
   audio starting; the response audio plays cleanly with no clipping.
7. Click **End call**.
8. Verify the chat transcript shows the captured turns (text mode).
9. Verify `sessions.voice_call_started_at` and
   `sessions.voice_call_ended_at` are set in the DB.
10. Verify `voice_minute_usage` has a row for today with
    `seconds_used` ≈ the call duration.
11. Verify `state_snapshot.analysis.voice` includes
    `user_avg_wpm`, `user_filler_count`, `longest_silence_sec`,
    and a `turns` array with both roles.

### E. Persona rollout (sanity)

For each of the 9 personas, start a 30s call and confirm the voice
*character* feels right (subjective check):

- [ ] **brenda** — formal, slightly slow.
- [ ] **alex** — energetic, fast.
- [ ] **david** — slow-deliberate, long pauses.
- [ ] **sarah** — rushed, slightly anxious.
- [ ] **michael** — terse, low-energy.
- [ ] **chloe** — fast, anxious; obvious filler density.
- [ ] **priya** — measured, technical.
- [ ] **vikram** — friendly, slightly fast, slightly evasive.
- [ ] **marcus** — slow, dry; interrupts much less than the others.

### F. Barge-in mechanics

- [ ] Start a call where the persona is in the middle of a long reply.
      Speak; persona TTS should stop within ~300ms (Vikram defaults
      `bargeInToleranceMs: 200`) and the persona should re-engage
      with the new user input.
- [ ] Repeat against **marcus**: he should *not* stop on a brief
      throat-clear (his `bargeInToleranceMs: 600` is intentionally
      tolerant).

### G. Quota enforcement

- [ ] Set `VOICE_DAILY_MINUTES_PER_USER=1`, restart the api + agent-voice.
- [ ] Start a call and just keep talking. Around ~60s in you should
      hear/see the `quota_warning` (banner + spoken heads-up), and the
      call should be **hard-disconnected** at the cap with a "Daily
      1-minute voice limit reached" alert — without pressing End call.
- [ ] Try to start a second call → `429 voice_quota_exhausted`.
- [ ] DB: `voice_minute_usage.seconds_used >= 60` for today (debited by
      the worker's authoritative internal end report).
- [ ] Concurrency: start a call, then (without ending it) `POST
      /sessions/:id/voice/start` again → `409 voice_call_in_progress`.

### H. Regression sweep (text mode unchanged)

- [ ] `cd agent && uv run pytest -q` → all green (~158 tests at merge).
- [ ] `cd api && pnpm test --run` → all green (~115 tests at merge).
- [ ] `cd web && pnpm lint && pnpm typecheck` → clean.
- [ ] Manual: open a fresh **text** session against Brenda and finish
      one short conversation. State persistence, goal eval, and
      analysis on the post-session page must work *exactly* as they did
      before voice mode existed (text chat is unaffected by the voice
      flag, on or off).

### I. Performance baseline

- [ ] `cd agent && uv run python scripts/voice_perf.py --runs 50` →
      `user_turn` p95 within 50ms (stub adapter), `stream_chunks` p95
      within 5ms. Numbers should be roughly stable across re-runs;
      keep the output as a baseline and compare it after any change to
      the pipeline or providers (attach it to the relevant PR / release
      notes if it shifts materially).

## Known limitations (not blockers)

* **One worker, one room** — the LiveKit Agents SDK lets a single
  worker process pick up many rooms; we ship with the SDK's default
  concurrency. Production sizing is documented in the deploy runbook
  (separate doc).
* **English-only smoke** — the persona content is English, the local
  models default to English. Non-English voices are wired up but
  unsmoked.
* **No transcript redaction** — the worker forwards raw transcripts
  to the API on the user's bearer; secrets the user speaks land in
  the same place chat messages do. Document for security review.
