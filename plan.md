# Town plan

This is a direction document, not a promise to build every item immediately. The current town should remain small, deterministic, inspectable, and cheap while the simulation earns more complexity.

## Current boundary

- Ten-resident Rookwood seed with eleven locations and twelve seeded relationships.
- Deterministic scripted game AI; no model calls.
- One SQLite-backed `RookwoodTown` Durable Object for persistent state, events, and an hourly alarm heartbeat when deployed.
- A read-only dashboard with an explicit ephemeral preview fallback via `ticks`.
- The original three-resident seed remains available as a compact regression scenario.

## North-star architecture

The town should be a hybrid simulation:

```text
daily planner → structured plan → validator → deterministic executor → events → memory
```

Ordinary code owns the world. It handles time, resources, inventory, legality, schedules, transactions, needs, and consequences. A model may help a resident decide what matters, but it must not become the authority on what actually happened.

For the first persistent town, use one SQLite-backed Durable Object named for the town, such as `rookwood`. It should be the single coordinator for the world clock, state projection, event log, and scheduled wake-ups. This is one object for the town, not one object per resident. D1 remains an optional shared SQL layer for later cross-town queries, analytics, administration, or reporting.

## Daily planner contract

The eventual model adapter should make at most one call per resident per simulated day. That is a budget ceiling, not a requirement to call residents who have nothing meaningful to reconsider. Calls should remain staggered and subject to the existing off-peak policy.

A daily plan may contain:

- A small priority-ordered set of goals.
- Several bounded action intentions for the day.
- Conditional branches expressed as machine-readable predicates, not vague prose.
- Social intentions such as seeking, avoiding, helping, warning, or negotiating with another resident.
- A compact memory update or reflection for the next planning call.

The plan should use a finite vocabulary of actions and conditions. For example, `food_stock > 0` and `price <= budget` are executable predicates; “if food is available” is not.

The model proposes intent. It never directly sets money, inventory, relationships, health, or event history. The validator checks every proposed action against current state, and the executor applies only legal results.

## Memory and social information

A few lines of global prose are not sufficient memory. Prefer separate, compact records for:

- Immutable facts and recent witnessed events.
- The resident's beliefs and uncertainty.
- Commitments and planned obligations.
- Relationship impressions and changes in affinity.
- Rumors or claims, attributed to their source and propagated selectively.

A resident's statement should remain that resident's statement. It should not silently become town-wide truth, and other residents should not receive omniscient knowledge for free.

## Build sequence

### 1. Stabilize the deterministic world

Keep expanding the ordinary rules and event types while preserving replayability, bounded state, and readable dashboard output.

### 2. Make one town persistent — foundation landed

The repository now has one SQLite-backed `RookwoodTown` object. It persists the current projection and event log, exposes read-only state/event/health reads through the Worker, and uses an alarm to advance the scripted simulation by one simulated hour per wall-clock hour. The object is configured with the current SQLite class export format and remains one coordinator for the whole town.

The remaining reliability work here is deliberately unglamorous: checkpoints, retries, alarm observability, and a clear simulation clock before model calls are allowed. Do not add D1 merely because it is a database. Introduce it when the project has a real need for shared relational queries beyond one town object.

### 3. Introduce a daily-plan interface

Replace the current one-step decision shape with a plan interface that both a scripted planner and a future model planner can satisfy. The scripted planner remains the reference implementation and test oracle.

### 4. Trial one model resident

Give one resident a DeepSeek planner behind a strict schema, token budget, timeout, retry limit, and deterministic fallback. Record call reasons, token usage, rejected intents, and resulting events. Do not let the model mutate storage.

### 5. Add social consequences carefully

Allow plans to create social intentions, then let the deterministic engine decide whether meetings, exchanges, promises, and conflicts actually occur. Add model calls only when the existing daily plans and local rules cannot resolve an important event.

### 6. Grow the town only when the systems need it

Ten residents are enough for the first meaningful town. Increase population after the economy, relationships, memory, scheduling, and viewer can explain what happened. Population is not a substitute for interacting systems.

## Guardrails

- No continuous LLM thought loop.
- No unbounded resident-to-resident conversation chains.
- No model-authored balance changes or direct database writes.
- No giant unfiltered transcript in every prompt.
- No automatic publishing, merging, deleting, or other irreversible side effects by default.
- Preserve a small deterministic scenario for fast regression tests.

