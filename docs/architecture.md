# Architecture notes

Calder Station is a simulation with an occasional language-model decision layer, not a collection of chat sessions wearing names.

## Core loop

1. Advance the world clock and apply deterministic needs and timing.
2. Pull residents whose planning turn is due.
3. Ask an eligible adapter for a bounded daily plan.
4. Validate the plan against the current town.
5. Put its finite action intentions into the resident's queue.
6. Execute queued actions at their scheduled times, applying movement, legality, interruption, social resolution, and consequences in ordinary code.
7. Expire and renew commitments, append compact events, and persist the projection.

The model returns intent. The simulation remains authoritative about what actually happened.

## Current world slice

The authored seed contains fifteen residents, fourteen places, twenty-seven relationship edges, and one renewable delivery commitment. Residents have homes, workplaces, routines, needs, relationships, planning times, and bounded action queues. Social intentions only become encounters when both people are related, co-located, and available.

The initial commitment creates a causal chain: a notice is assigned, Sal chooses fulfillment or delay, the relationship changes, and a bounded follow-up can be created after a cooldown. Missed due times break the commitment and apply a larger relationship penalty. Renewal has a generation cap and an open-commitment cap.

## Plan and action boundaries

`src/daily-plans.js` defines version 2 of the planner contract. A plan contains short priorities and one to five ordered action intentions. Each action has a finite action vocabulary, a known location, short UI text, and an optional offset from the planning turn. The executor converts those offsets into queue entries and owns the clock.

The validator rejects unknown actions, locations, residents, relationships, stale plan days, overlong prose, unavailable obligations, non-monotonic offsets, and unsupported versions. The DeepSeek adapter currently returns one action because its experiment is still limited to a single commitment decision; it crosses the same validator and executor as scripted intent.

If a queued action is no longer reasonable because of a hard need, deterministic code replaces it with eating or rest and records the interruption. If a new planning turn arrives with unfinished intentions, the old remainder is explicitly superseded. There is no hidden resident process and no model-managed clock.

## State and persistence

One Durable Object coordinates the town projection, event log, and hourly alarm. Residents are ordinary records, not separate Durable Objects. The event log is append-only and the projection stores only a small recent event context; the full history remains queryable through SQLite.

Production and staging are separate Worker environments and use separate object names: production retains the existing `rookwood` storage key, while staging uses `rookwood-staging`. The public display name is stored as `Calder Station` in both. A one-time migration updates old stored event text to the canonical names; the frontend no longer performs runtime legacy-name substitution.

Seed reconciliation adds authored records and refreshes authored identity/routine metadata without resetting evolved needs, location, queue, relationships, or history. Stable internal IDs remain stable across editorial renames.

## Long-horizon runner

`src/scenario-runner.js` starts a clean staging seed and advances through `advanceTown`; it does not maintain a parallel fake engine. The CLI runs requested checkpoints such as 1, 7, 30, and 90 simulated days in daily batches while the engine still processes every plan and queued action at its actual timestamp.

Each report includes:

- event counts and per-resident plan/action totals;
- action distribution and activity by location;
- relationship changes and largest gains/losses;
- commitments created, fulfilled, delayed, broken, open, and highest generation;
- model attempts, successful calls, fallbacks, and token totals;
- min/max energy and hunger over the whole run;
- duplicate IDs, invalid references, overdue open commitments, due queue entries, need bounds, and obvious rest/no-activity loops.

The seed, start time, authored rules, and deterministic adapter make a replay comparable across code changes. Reports contain no wall-clock timestamps or random values.

## Model policy

The adapter is eligible only for the current Sal commitment experiment. It receives a compact state snapshot and recent events, returns JSON with a small output budget, and has a typed timeout/provider/validation failure path. A fallback plan is selected by deterministic rules. Usage and fallback status become projection statistics and events.

Routine mechanics remain scripted. More model-eligible incident classes should wait until the first one is easy to explain from the event history and long-horizon reports.

## Viewer

The Folio UI is a read-only register, not an operations console. It shows the current hour, journal, places, people, relationships, queued actions, and individual histories. Portrait assets are part of the resident identity presentation. The map is a separate route over the same projection, and browser routes are served by the static Worker asset layer.

Polling remains once per minute. WebSockets, controls that mutate the town, and a second frontend generation are deferred until a concrete need appears.

## Deferred infrastructure

One coordinator plus embedded SQLite is enough for the current town. D1 is appropriate later for shared analytics or cross-town queries; Queues or Workflows are appropriate when real fan-out or durable multi-step work exists. Neither is justified by population alone.
