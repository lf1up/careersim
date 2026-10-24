# Multi-character text simulations

The `release-planning-panel` simulation is a playable example with Alex Chen and Brenda Vance. Start it from the simulation catalogue. The user opens the meeting; each user turn produces at most two sequential character replies. The second character sees the first reply. Casts of two to eight characters rotate in configured order.

## Enable locally

Apply the additive API migration before running this branch against an existing database:

```sh
cd api
pnpm db:migrate
```

Then start the normal `api`, `web`, and `agent` services. No additional packages or services are required. The migration adds nullable `event_id`, `actor_id`, and `actor_name` fields to messages and a unique index on `(session_id, event_id)`. Existing rows and single-persona sessions remain usable.

## Configure a cast

In `agent/data/simulations.json`, add a `participants` array:

```json
"participants": [
  {
    "actorId": "alex",
    "personaSlug": "alex-chen-tech-lead",
    "objective": "Advocate a safe, small release.",
    "privateKnowledge": "Two optional features can be postponed."
  },
  {
    "actorId": "brenda",
    "personaSlug": "brenda-vance-hr-manager",
    "objective": "Protect sustainable staffing.",
    "privateKnowledge": "The team has raised workload concerns."
  }
]
```

`actorId` identifies an instance, so two instances may reuse one persona. IDs must be unique lowercase identifiers (letters, digits, underscores, hyphens; start with a letter; maximum 64 characters). `user` and `director` are reserved. Scenarios without `participants` keep their existing `personaSlug` behavior. The example also keeps `personaSlug` for older authoring tools; when participants exist, their first entry is the primary catalogue persona.

Each character receives its own persona, objective and private knowledge; only the public scenario and cast names/roles are shared. Other characters' speech is represented as observed dialogue, not the current character's assistant history. Private data is never inserted into transcript events. This is context isolation, not a guarantee that an LLM will never choose to disclose its own character's knowledge in dialogue.

## Persistence, interruption, and evaluation

Every serialized utterance has a stable event ID and actor identity. Old snapshots receive deterministic IDs when read. The API stores each streamed reply and its scheduler position before sending it to the browser. After interruption or reload, the next user message continues from the saved position; already delivered replies are not regenerated. There is no automatic background continuation while the user is silent.

The judge evaluates the pending, labeled event range once per completed round. Evidence contains `sourceEventIds`, and a cursor prevents the same completed range from being evaluated again. An interrupted range is included in the next evaluation. If evaluation fails, delivered messages remain saved and the cursor does not advance; the next user turn retries that range. Dialogue still completes normally; the public `evaluation_pending` flag displays a feedback-pending badge instead of presenting a failed send. The existing one-current-goal rubric remains in use, and source IDs describe the evaluated range rather than claiming a quote-level selection by the judge.

Public SSE `message` events use an explicit field allowlist. Public `done` contains `{ session }`, without raw internal state. Session detail exposes public participants and message identities. The authenticated internal voice endpoint retains its existing state contract for single-character voice sessions.

## Current limits

- Text only for group sessions; API rejects group voice and the UI disables calls.
- Inactivity nudges and explicit followup bursts are disabled for groups.
- The scheduler is deterministic; an AI director, scene events, private whispers, parallel deliberation, and autonomous scene progression are future work.
- Group replies do not use the legacy single-persona RAG or per-turn sentiment nodes. Public session emotion fields may remain empty for these sessions.
- Evaluation remains synchronous after speech, with the existing current-goal scoring policy.
- Cancellation preserves committed history but may not stop an already running upstream LLM call immediately.

The tests use deterministic model doubles and in-memory PostgreSQL. Live provider dialogue quality, billing, and a deployed migration require a separate smoke test.
