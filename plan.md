# Town plan

This is a direction document, not a promise to build every item immediately. The current town should remain small, deterministic, inspectable, and cheap while the simulation earns more complexity.

## Current boundary

- Fifteen-resident Rookwood seed with fourteen locations and twenty-seven seeded relationships.
- Hybrid planner boundary: deterministic preview plus one bounded DeepSeek experiment in the persistent alarm.
- One authored Sal/Vey obligation conflict: fulfill a sealed notice or report a delay.
- One SQLite-backed `RookwoodTown` Durable Object for persistent state, events, migration, and an hourly alarm.
- A read-only town journal with map occupancy, people, relationships, and bounded history.
- The original three-resident seed remains available as a compact regression scenario.

## North-star architecture

The town should be a hybrid simulation:

```text
daily planner → structured plan → validator → deterministic executor → events → memory
```

Ordinary code owns the world. It handles time, resources, inventory, legality, schedules, transactions, needs, and consequences. A model may help a resident decide what matters, but it must not become the authority on what actually happened.

For the first persistent town, use one SQLite-backed Durable Object named for the town, such as `rookwood`. It should be the single coordinator for the world clock, state projection, event log, and scheduled wake-ups. This is one object for the town, not one object per resident. D1 remains an optional shared SQL layer for later cross-town queries, analytics, administration, or reporting.

## Daily planner contract

The model adapter should make at most one call per eligible resident per simulated day. That is a budget ceiling, not a requirement to call residents who have nothing meaningful to reconsider. Calls should remain staggered and subject to the existing off-peak policy. The first experiment is narrower still: only Sal, only while Vey's sealed notice is open, one request, no retries.

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

Rookwood now has one SQLite-backed object that persists its projection and event log, serializes changes, migrates authored seed additions, and advances through an hourly alarm. Event history is no longer loaded wholesale to advance the town.

Do not add D1 merely because it is a database. Introduce it when the project has a real need for shared relational queries beyond one town object.

### 3. Introduce a daily-plan interface — landed

`src/daily-plans.js` now defines a versioned, validated plan contract. The scripted planner is the reference implementation and the legacy one-intent adapter remains compatible for tests. Version 1 intentionally executes one action per plan; the shape can grow only when the simulation has a real action queue.

### 4. Trial one model resident — first experiment landed

Sal Orin receives a DeepSeek planner for one obligation conflict: whether to fulfill Vey's sealed notice or report a delay. The adapter uses a strict JSON shape, a 260-token output cap, an eight-second timeout, no retries, a deterministic fallback, and the existing plan validator. The Durable Object records request usage, fallback status, and the resulting obligation/relationship event. The model never mutates storage.

The workflow is intentionally inspectable:

1. The alarm checks whether Sal's scheduled turn falls inside the next hourly step and whether the obligation remains open.
2. The adapter sends Sal's identity, needs, routine, bounded relationships, recent events, obligation, and two legal choices to DeepSeek.
3. The response is parsed as JSON and validated against the current town.
4. The deterministic executor applies delivery or delay, changes the Vey relationship by the authored amount, and appends an event.
5. A timeout, provider error, truncated response, invalid JSON, or invalid plan uses the scripted choice and records a fallback event.

### 5. Add social consequences carefully — first slice landed

Plans can create grounded talk intentions. The deterministic resolver only records an encounter when both residents are related, co-located, and not resting; it caps each resident at one encounter per simulated day and nudges the relationship strength upward. Exchanges, promises, conflicts, and richer memory remain future work.

### 6. Evaluate before expanding the experiment

Let the persistent town reach the eligible turn more than once across fresh seeded runs or controlled test fixtures. Compare model success, fallback rate, token usage, choice distribution, and whether the resulting event is understandable from the visible context. Keep the incident class bounded until that evidence is useful.

### 7. Grow the town only when the systems need it

Fifteen residents are enough for the next meaningful town. Do not grow again until economy, relationships, memory, scheduling, and the viewer can explain what happened. Population is not a substitute for interacting systems.

## Guardrails

- No continuous LLM thought loop.
- No unbounded resident-to-resident conversation chains.
- No model-authored balance changes or direct database writes.
- No giant unfiltered transcript in every prompt.
- No automatic publishing, merging, deleting, or other irreversible side effects by default.
- Preserve a small deterministic scenario for fast regression tests.
