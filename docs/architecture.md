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

The repository currently implements the loop without a model: a seeded ten-resident Rookwood state advances in hourly ticks, applies simple need changes, wakes residents at staggered routine slots, asks a scripted decision policy for an intent, validates and resolves that intent, and appends movement and decision events. The seed also contains eleven locations and twelve relationship edges, but relationships are not changing yet. `runPreview()` replays the same sequence from the same inputs, while the Worker exposes state and newest-first events as read-only projections. The preview is intentionally ephemeral and makes zero model calls. The seed is recorded as replay metadata; deterministic behavior comes from the rules and roster for now, with randomness deferred until it can be tested explicitly.

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

The first useful surface is deliberately small: a town overview, a resident list, a map-like location view, and a chronological event feed. Client-side routes such as `/map` and `/residents/mara` can exist before the simulation is real by rendering fixture data. This gives the project a visible feedback loop without coupling the UI to unfinished storage.

The deployed dashboard reads `/api/town` and `/api/events`. It currently receives a deterministic preview recomputed per request, which is enough to exercise the viewer without pretending that persistence exists. Polling will be sufficient for a tiny persistent town. A live stream can be added later without changing the page-level route model.

## Infrastructure direction

For a small deployment, one coordinator plus durable storage is enough. Residents should be rows or records, not one Durable Object and one workflow per personality by default. The next infrastructure slice is D1 for the event log and state projection, followed by one coordinator heartbeat. Cloudflare adapters should provide durability and wake-ups, not hide the domain rules.
