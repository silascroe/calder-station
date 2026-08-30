# Architecture notes

The town should be built as a simulation with an occasional language-model decision layer, not as a set of chat sessions wearing names.

## Core loop

1. Advance the world clock and apply deterministic mechanics: schedules, travel, inventory, hunger, wages, and other rules.
2. Pull events and residents whose next decision time is due.
3. Ask only eligible residents for a decision. Most residents should not need a model call on most ticks.
4. Validate the returned intent against the current world state.
5. Apply the accepted action transactionally and append a compact event.
6. Update or compact memory, then schedule the resident's next wake-up.

The model returns intent. The simulation remains the authority on what actually happened.

## Current implementation slice

The repository implements the loop without a model: a fifteen-resident Rookwood advances in hourly ticks, applies need changes, wakes residents at staggered slots, asks a scripted policy for intent, validates the result, and appends events. Fourteen places and twenty-seven relationship edges give the world useful structure, though relationships do not change yet. `runPreview()` remains a deterministic replay tool; the deployed default is persistent and makes zero model calls.

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

## Durable Object boundary

One SQLite-backed Durable Object, `RookwoodTown`, owns Rookwood's projection, append-only events, and alarm. Residents remain ordinary records; they are not separate Durable Objects. World rules remain in the domain modules rather than the Worker or storage adapter.

Persisted projections carry a seed revision and reconcile with authored residents, places, and relationships on load. Reconciliation only adds missing authored records; it preserves evolved resident state and historical events. The projection also owns the monotonic event count. Alarms therefore advance from a compact projection and persist only newly produced events instead of reading an unbounded log into memory. Viewer event reads are bounded to 200 records.

## Cost guardrails for the eventual model adapter

- Use structured JSON with a small output budget.
- Put immutable identity and rules before dynamic state so repeated prefixes can be cached.
- Send a compact state snapshot, not the resident's entire history.
- Use deterministic rules for routine mechanics.
- Cap resident decisions, retries, and spawned social interactions per world day.
- Record input/output token counts and the reason each model call was made.
- Reserve a stronger or thinking model for rare high-impact events.

## Viewer direction

The dashboard is a separate read-only window into the simulation. It should consume projections and events; it should not contain world rules or call the model directly.

The viewer is organized as a town journal rather than an operations dashboard: what is happening now, where people are, who is likely to act next, and what one resident's ordinary life looks like. The map groups occupancy by place instead of overlapping resident markers. Simulation counters remain available but are deliberately secondary.

The viewer reads `/api/town` and a bounded `/api/events` feed, refreshes once per minute while visible, and contains no world rules. WebSockets would add machinery without improving an hourly simulation and are deferred.

## Infrastructure direction

One coordinator plus its embedded SQLite storage is enough. D1 is optional for later analytics, administration, or cross-town queries. Queues, Workflows, and one-object-per-resident designs are also deferred until contention or fan-out exists in reality.
