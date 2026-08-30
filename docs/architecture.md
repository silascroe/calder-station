# Architecture notes

The town should be built as a simulation with an occasional language-model decision layer, not as a set of chat sessions wearing names.

## Core loop

1. Advance the world clock and apply deterministic mechanics: schedules, travel, inventory, hunger, wages, and other rules.
2. Pull residents whose daily plan time is due.
3. Ask only eligible residents for a plan. Most residents should not need a model call on most ticks; in the first experiment, only Sal with an open obligation is eligible.
4. Validate the structured plan against the current world state. A provider failure or rejected response selects a deterministic fallback instead.
5. Apply the accepted action transactionally, resolve any legal social intention or obligation consequence, and append compact events.
6. Update or compact memory, then schedule the resident's next plan time.

The model returns intent. The simulation remains the authority on what actually happened.

## Current implementation slice

The repository implements a hybrid slice: a fifteen-resident Rookwood advances in hourly ticks, applies need changes, wakes residents at staggered slots, and asks a planner for one bounded daily action plus an optional social intention. Fourteen places, twenty-seven relationship edges, and one seeded obligation give the world useful structure. When two related residents are actually co-located and available, the social resolver records an encounter and slightly strengthens that relationship. `runPreview()` remains a deterministic replay tool. The persistent default can make one DeepSeek request only for Sal's open sealed-notice obligation; the plan is validated and resolved by the same deterministic executor as scripted plans.

## Scheduling policy

The current scheduler encodes DeepSeek's published UTC peak windows for weekdays: 01:00–04:00 and 06:00–10:00. Routine decisions requested during those windows move to the end of the window. Urgent decisions can bypass the delay.

Daily routine decisions are assigned distinct, deterministic slots across the remaining off-peak time. The assignment rotates with the date, so residents do not all wake together and the same resident is not permanently stuck with the same minute. The policy is intentionally pure so it can be tested locally and replaced if provider pricing changes.

The scheduler is not the simulation clock. The world can advance in fifteen-minute increments, hourly increments, or by the next event; only a subset of those transitions should produce model work.

## State boundaries

Keep these concerns separate:

- **World state:** facts such as location, cash, inventory, health, jobs, relationships, and current time.
- **Event log:** small immutable facts describing accepted changes. It is the audit trail, not a transcript dump.
- **Resident memory:** compact summaries and selected memories retrieved for a decision.
- **Decision adapter:** a replaceable interface that turns a bounded state snapshot into structured intent.
- **Resolver:** deterministic validation and application of intent.
- **Scheduler:** next wake-up time, priority, retry count, and provider cost policy.

An LLM response should never be allowed to mutate storage directly. That is how a funny town becomes an expensive bug farm.

## Daily plan contract

`src/daily-plans.js` defines version 1 of the planner boundary. A plan contains the resident and UTC day it belongs to, one finite-vocabulary executable action, short priorities, and at most two grounded social intentions. The current scripted planner is the reference implementation. The executor intentionally accepts one action per plan for now; multi-step plans should not be added until the simulation has a real action queue.

The validator rejects unknown actions, locations, residents, relationships, stale plan days, overlong prose, unavailable obligations, and unsupported versions before the resolver sees the plan. The DeepSeek adapter returns the same shape, requires an obligation choice for this experiment, and rejects social intentions so this first test measures one incident class at a time.

## Durable Object boundary

One SQLite-backed Durable Object, `RookwoodTown`, owns Rookwood's projection, append-only events, and alarm. Residents remain ordinary records; they are not separate Durable Objects. World rules remain in the domain modules rather than the Worker or storage adapter.

Persisted projections carry a seed revision and reconcile with authored residents, places, relationships, and obligations on load. Reconciliation only adds missing authored records; it preserves evolved resident state and historical events. The projection also owns the monotonic event count. Alarms therefore advance from a compact projection and persist only newly produced events instead of reading an unbounded log into memory. The coordinator loads only the eight newest events as bounded context for a model decision; viewer event reads are bounded to 200 records.

## Cost guardrails for the model adapter

- Use structured JSON with a small output budget; the current request caps output at 260 tokens.
- Put immutable identity and rules before dynamic state so repeated prefixes can be cached.
- Send a compact state snapshot and at most eight recent events, not the resident's entire history.
- Use deterministic rules for routine mechanics.
- Cap resident decisions, retries, and spawned social interactions per world day; the current experiment makes one request and retries zero times.
- Record input/output token counts, fallback reasons, and the resulting event.
- Give the model only legal choices whose consequences are implemented by ordinary code.
- Reserve a stronger or thinking model for rare high-impact events.

## Viewer direction

The dashboard is a separate read-only window into the simulation. It should consume projections and events; it should not contain world rules or call the model directly.

The viewer is organized as a town journal rather than an operations dashboard: what is happening now, where people are, who is likely to act next, and what one resident's ordinary life looks like. Encounters appear in the journal, relationship pages show social moments, and the map groups occupancy by place instead of overlapping resident markers. Simulation counters remain available but are deliberately secondary.

The viewer reads `/api/town` and a bounded `/api/events` feed, refreshes once per minute while visible, and contains no world rules. Resident pages show an obligation status and whether the latest plan was shaped by DeepSeek or a scripted fallback. WebSockets would add machinery without improving an hourly simulation and are deferred.

## Infrastructure direction

One coordinator plus its embedded SQLite storage is enough. D1 is optional for later analytics, administration, or cross-town queries. Queues, Workflows, and one-object-per-resident designs are also deferred until contention or fan-out exists in reality.
