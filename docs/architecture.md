# Architecture notes

Calder Station is a simulation with an occasional language-model decision layer, not a collection of chat sessions wearing names.

## Core loop

1. Advance the world clock and apply deterministic needs and timing.
2. Pull residents whose planning turn is due.
3. Await an eligible adapter for a bounded daily plan at that exact simulated instant.
4. Validate the plan against the current town.
5. Put its finite action intentions into the resident's queue.
6. Execute queued actions at their scheduled times, applying movement, legality, interruption, social resolution, and consequences in ordinary code.
7. Expire and renew commitments, append compact events, and persist the projection.

The model returns intent. The simulation remains authoritative about what actually happened.

## Current world slice

The authored seed contains fifteen residents, fourteen places, twenty-seven relationship edges, and one legacy renewable delivery commitment. Residents have homes, workplaces, routines, needs, relationships, planning times, and bounded action queues. Social intentions only become encounters when both people are related, co-located, and available.

Four authored civic chains add broader causal history without a general story generator. Each step names an owner, counterparty, destination, legal action, and follow-up. Fulfillment schedules the next authored step; delay retries the step; failure ends the cycle until a cooldown. IDs encode chain/cycle/step/attempt and parent IDs make the lineage inspectable. The route chain can overlap Sal's clerk notice, creating a genuine competing commitment while the plan still selects only one bounded obligation action.

Relationships retain their authored baseline plus evolving strength, tension, interaction count, and last-interaction time. Fulfillment can strengthen a tie with diminishing returns; delay and failure weaken it and add tension. A later co-located conversation may be tense, repairing, or warm. This prevents every social edge from monotonically converging on 100 while leaving consequences deterministic and auditable.

## Plan and action boundaries

`src/daily-plans.js` defines version 2 of the planner contract. A plan contains short priorities and one to five ordered action intentions. Each action has a finite action vocabulary, a known location, short UI text, and an optional offset from the planning turn. A social intention may point at one action in that finite queue; the executor converts offsets into queue entries and owns the clock.

The validator rejects unknown actions, locations, residents, relationships, stale plan days, overlong prose, unavailable obligations, non-monotonic offsets, and unsupported versions. The DeepSeek adapter currently returns one action because its experiment is still limited to a single commitment decision; it crosses the same validator and executor as scripted intent.

If a queued action is no longer reasonable because of a hard need, deterministic code replaces it with eating or rest and records the interruption. If a new planning turn arrives with unfinished intentions, the old remainder is explicitly superseded. There is no hidden resident process and no model-managed clock.

Scripted planners first use naturally shared destinations. For a relationship with no recorded encounter or unresolved tension, they may add one bounded call at the other resident's ordinary workplace, meal stop, or evening place when time and queue capacity permit. Co-location, wakefulness, and daily encounter limits still decide whether the call succeeds. The planner proposes a visit; it never moves the target.

## State and persistence

One Durable Object coordinates the town projection, event log, and hourly alarm. Residents are ordinary records, not separate Durable Objects. The event log is append-only and the projection stores only a small recent event context; the full history remains queryable through SQLite.

The production clock uses an explicit `pause-on-downtime` policy: one successful alarm advances exactly one simulated hour, and the next alarm is scheduled from completion. A long Worker outage therefore pauses Calder Station instead of triggering a model-call storm or silently fast-forwarding months. Health output exposes this policy, the last advanced interval, retry count, and next alarm.

Alarm and model side effects have small durable leases. An alarm retry checks whether its intended starting projection already advanced before doing more work. Each eligible model planning instant stores a pending/completed decision record outside the projection; a completed response can be reused if town persistence was interrupted, while an outcome-unknown pending request falls back deterministically instead of spending twice. SQLite projection and event writes remain one synchronous transaction. A caught alarm failure records only its error class in health data and schedules a fresh attempt one real hour later, avoiding Cloudflare's six-retry terminal state without running a tight failure loop.

Production and staging are separate Worker environments and use separate object names: production retains the existing `rookwood` storage key, while staging uses `rookwood-staging`. The public display name is stored as `Calder Station` in both. A one-time migration updates old stored event text to the canonical names; the frontend no longer performs runtime legacy-name substitution.

The `TOWN` binding is declared separately in each Wrangler environment because Durable Object bindings are not inherited. Config validation runs before deployment, and a post-deploy smoke check requires the expected environment, Durable Object key, persistence mode, and alarm. At runtime, a configured environment missing `TOWN` returns HTTP 503; only an explicit preview request may use ephemeral state there.

Seed reconciliation adds authored records and refreshes authored identity/routine metadata without resetting evolved needs, location, queue, relationships, or history. Stable internal IDs remain stable across editorial renames.

Runtime metadata backfills—civic progress, generic obligation actions, relationship tension fields, and new counters—are detected independently of seed revision and persisted after loading an evolved projection. They never replace the existing resident, queue, relationship strength, or event history.

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
- repeated per-resident daily patterns, event-template concentration, relationship direction/saturation, social encounter coverage, any-causal-activity coverage, personal meaningful-history counts, and resident participation by place.

The seed, start time, authored rules, and deterministic adapter make a replay comparable across code changes. Reports contain no wall-clock timestamps or random values.

## Model policy

The adapter is eligible only for the current Sal commitment experiment. It receives a compact authoritative state snapshot and recent events at Sal's actual planning instant, returns JSON with a small output budget, and has a typed timeout/provider/validation failure path. A fallback plan is selected by deterministic rules. Usage and fallback status become projection statistics and events.

`advanceTown` and the scenario runner are asynchronous, but there is still one authoritative execution path. Deterministic adapters resolve immediately; paid adapters are awaited before validation and queueing. The engine therefore cannot prefetch intent from stale state while other residents, needs, expiries, or relationship changes are still pending before the planning turn.

Provider pricing policy uses injected real wall-clock time. Calder Station's simulated date never determines whether a call is peak-priced. Routine autonomous calls are skipped during DeepSeek's published weekday 01:00–04:00 and 06:00–10:00 UTC peak windows; deliberate evaluation has an explicit bypass. Time injection keeps normal tests independent of the actual hour. As verified on 2026-08-30, `deepseek-v4-flash` is $0.22/M cache-miss input and $0.66/M output tokens off-peak, with peak rates twice those amounts.

Resident planning slots span the entire simulated day. They never move to accommodate provider pricing; only the real request boundary applies the cost policy.

`src/hybrid-planner.js` is the single scripted/model selection boundary used by both the persistent object and evaluation. The paid evaluation matrix creates fresh staging states, varies needs, distance, trust, and deadline pressure, then advances each through `advanceTown`. It records both model intent and the executed obligation outcome, which exposes cases where deterministic need interruption legitimately defeats a valid proposal.

Staging has a fixed evaluation revision and a server-side Cron trigger. The trigger checks a report stored in the staging town object's SQLite-backed KV storage and runs the 24-case matrix once per revision. It stores `running` before the first provider call; `running`, `failed`, and `complete` are all non-retrying states, so a killed or failed evaluation cannot spend again every hour. Retrying deliberately requires a new revision. Production declares no evaluation trigger. The public staging API can read the report but cannot trigger, reset, or configure paid calls. Because Worker secrets are environment-specific, staging requires its own `DEEPSEEK_API_KEY`; post-deploy smoke verification requires `modelReady: true`.

Routine mechanics remain scripted. More model-eligible incident classes should wait until the first one is easy to explain from the event history and long-horizon reports.

## Viewer

The Folio UI is a read-only register, not an operations console. It shows the current hour, journal, places, people, relationships, queued actions, and individual histories. Portrait assets are part of the resident identity presentation. The map is a separate route over the same projection, and browser routes are served by the static Worker asset layer.

Polling remains once per minute. WebSockets, controls that mutate the town, and a second frontend generation are deferred until a concrete need appears.

## Deferred infrastructure

One coordinator plus embedded SQLite is enough for the current town. D1 is appropriate later for shared analytics or cross-town queries; Queues or Workflows are appropriate when real fan-out or durable multi-step work exists. Neither is justified by population alone.
