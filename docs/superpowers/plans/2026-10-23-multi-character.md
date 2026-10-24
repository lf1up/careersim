# Multi-character text simulations: first v2 slice

Approved direction: retain LangGraph, add two sequential characters, keep private state server-side, preserve speaker identity through cancellation and reload. Work on codex/multi-character-simulations; preserve the existing lockfile change and draft data.

## Design and contracts

Opt-in simulations declare participants: [{actorId, personaSlug, objective?, privateKnowledge?}]. Actor IDs are unique safe identifiers, reserved user excluded; 2–8 participants supported. Legacy personaSlug configurations remain supported. A bounded scheduler rotates through the cast, at most two replies per user turn. Each character gets its own persona, objective and private knowledge, the public scenario, a public cast list, and the public transcript with other characters represented as observed speech, never its own assistant history. No shared character secrets or scoring rubric enter character prompts. Scheduler position advances with each durable utterance.

Messages add optional event_id, actor_id, actor_name to the existing role/content wire contract. IDs survive serialization. Public events are speech visible to everyone in this slice; private messages and world mutation events are deferred. Private character state never becomes a transcript entry. Streaming merges messages by ID consistently with LangGraph and emits unseen AI messages, independent of node names or list lengths.

Public session detail adds participants: [{actor_id, name, persona_slug, role}] (empty for legacy sessions is acceptable). Persist optional message identity columns and expose them on SSE and session read. Public SSE uses an explicit projection; only internal authenticated routes retain raw state if their existing consumers require it. Group voice is rejected server-side and unavailable in the UI. Group inactivity/followup nudges are disabled for this first slice.

The judge runs once after the round, against labeled utterances since an evaluation cursor. Evidence includes source event IDs; a later turn includes unevaluated interrupted replies. Existing goal scoring remains; full multi-goal asynchronous assessment and an LLM director are subsequent slices.

## Tasks

1. Agent: add regression tests for identity roundtrip, private prompt isolation, ordered two-character replies, streaming identity, interrupted snapshot continuation and evaluation ranges. Implement participant loading, scene graph branch, serialized IDs and reducer-consistent streams. Add one group scenario.
2. API (independent after this contract): regression tests for raw-state exclusion and speaker identity roundtrip. Add additive migration, schemas and projections; preserve internal voice contract, reject group voice, disable group nudges.
3. Web (independent after this contract): render per-message names/avatars for persisted and streamed replies, preserve identity across interruption, hide group voice. Test consecutive speakers and legacy rendering.
4. Integrate: run agent/API/web suites, TS checks and lint. Review complete diff, fix material findings, commit only feature files. Do not merge or deploy.

## Review focus

Legacy snapshots without IDs; same persona in distinct actor instances; private knowledge separation; second reply seeing first; cancellation after first committed reply; no stale scheduler/evaluation cursor; unknown metadata rejected at the public boundary; internal voice remains compatible.

## Progress

- Branch created. Existing unrelated changes preserved.
- Decision: deterministic bounded scheduler first; an LLM director adds another behavior and failure surface beyond the approved two-character foundation.
- Agent implementation and regression tests complete; JSONB key reordering covered by interrupted-resume test.
- API migration generated with Drizzle; public-state and identity tests pass. Internal voice contract preserved.
- Web speaker identity preserved through pending/kept/committed bubbles; group calls unavailable.
- Independent review confirmed one judge-failure cursor issue; added a failing regression and explicit failure handling to keep the cursor pending.
- Scope decision: group runtime skips legacy single-persona retrieval and sentiment nodes; documented in docs/MULTI_CHARACTER.md. Sharing that context would compromise character isolation.
- Review fix refinement: a judge outage returns a completed dialogue with evaluation_pending=true, keeps the cursor and progress unchanged, and displays a pending-feedback badge. This avoids making a durable user message look like a failed send. Regression verifies the final stream snapshot.

## Final verification

- Agent: 323 passed, 2 skipped; one existing pytest fixture deprecation warning.
- API: 206 passed across 20 files; typecheck and production build passed. Lint has zero errors and two existing unused-variable warnings in auth/altcha plugins.
- Web: 42 passed across 4 files; typecheck and lint passed. Production build passed with optional Ghost configuration disabled because the configured local Ghost service is unavailable.
- git diff --check passed. No live model smoke test or database migration was performed.
- Keeping the implementation on the requested separate local branch; no merge, push, or deployment.
