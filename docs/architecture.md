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

`src/daily-plans.js` defines version 3 of the planner contract. A plan contains short priorities and one to five ordered action intentions. Each action has a finite action vocabulary, a known location, short UI text, and an optional desired offset from the planning turn. A social intention may point at one action in that finite queue. A plan may also bind up to three obligation intents to specific actions; this lets ordinary code queue all reachable due work while the model still selects only priority.

Desired offsets are not arrival times. The executor derives walking time from authored map coordinates, applies a bounded service duration by action type, and shifts later work behind travel and prior service. The same timing projection tests every permutation of up to three due commitments. If one ordering can meet every deadline, scripted code uses it. A model call is eligible only when each offered promise is individually reachable but no ordering can save them all.

The validator rejects unknown actions, locations, residents, relationships, stale plan days, overlong prose, unavailable obligations, non-monotonic offsets, and unsupported versions. DeepSeek's experiment is narrower than the plan contract: the provider may return only an offered obligation ID, one legal choice, and a short note. When commitments conflict, it may fulfill the primary, explicitly delay it, or fulfill one bounded competing commitment; unattended work remains governed by its real deadline. Deterministic code turns that choice into the same complete, legal daily queue used by scripted planning. The model therefore cannot author movement, timing, status, mood, or consequences, and participating in a decision does not erase Sal's ordinary meals, work, social intentions, or return home.

If a queued action is no longer reasonable because of a hard need, deterministic code replaces it with eating or rest and records the interruption. Travel can therefore make a later need more urgent, and an arrival after a deadline fails through the normal expiry path. If a new planning turn arrives with unfinished intentions, the old remainder is explicitly superseded. There is no hidden resident process and no model-managed clock.

Scripted planners first use naturally shared destinations. For a relationship with no recorded encounter or unresolved tension, they may add one bounded call at the other resident's ordinary workplace, meal stop, or evening place when time and queue capacity permit. Co-location, wakefulness, and daily encounter limits still decide whether the call succeeds. The planner proposes a visit; it never moves the target.

## State and persistence

One Durable Object coordinates the town projection, event log, and hourly alarm. Residents are ordinary records, not separate Durable Objects. The event log is append-only and the projection stores only a small recent event context; the full history remains queryable through SQLite. Reads use SQLite insertion order rather than lexical event IDs, and load repairs a missing or regressed projection sequence from the newest durable event before another ID can be issued.

The production clock uses an explicit `pause-on-downtime` policy: one successful alarm advances exactly one simulated hour, and the next alarm is scheduled from completion. A long Worker outage therefore pauses Calder Station instead of triggering a model-call storm or silently fast-forwarding months. Health output exposes this policy, the last advanced interval, retry count, and next alarm.

Alarm and model side effects have small durable leases. An alarm retry checks whether its intended starting projection already advanced before doing more work. Each eligible model planning instant stores a pending/completed decision record outside the projection; a completed response can be reused if town persistence was interrupted, while an outcome-unknown pending request falls back deterministically instead of spending twice. SQLite projection and event writes remain one synchronous transaction. A caught alarm failure records only its error class in health data and schedules a fresh attempt one real hour later, avoiding Cloudflare's six-retry terminal state without running a tight failure loop.

Production and staging are separate Worker environments and use separate object names: production retains the existing `rookwood` storage key, while staging uses `rookwood-staging`. The public display name is stored as `Calder Station` in both. A one-time migration updates old stored event text to the canonical names; the frontend no longer performs runtime legacy-name substitution.

The `TOWN` binding is declared separately in each Wrangler environment because Durable Object bindings are not inherited. Commits to `main` automatically pass tests and deploy isolated staging; production remains an explicit workflow dispatch. Config validation runs before either deployment, and a post-deploy smoke check requires the expected environment, Durable Object key, persistence mode, and alarm. At runtime, a configured environment missing `TOWN` returns HTTP 503; only an explicit preview request may use ephemeral state there.

Seed reconciliation adds authored records and refreshes authored identity/routine metadata without resetting evolved needs, location, queue, relationships, or history. Stable internal IDs remain stable across editorial renames.

Each resident projection also retains at most twelve distinct personal turning-point threads: model-authored choices, provider fallbacks, broken or delayed promises, and obligation-related interruptions. Repeated failures in one obligation series update that thread's count and latest occurrence instead of crowding out unrelated history. These are references-in-context, not a replacement event log. The cap keeps projection growth flat while allowing a Day-1 consequence to remain visible after the newest town-wide event page has moved on. Existing production projections begin collecting this index after migration; historical SQLite events are not rewritten or bulk-scanned merely to backfill presentation data.

Runtime metadata backfills—civic progress, generic obligation actions, relationship tension fields, and new counters—are detected independently of seed revision and persisted after loading an evolved projection. They never replace the existing resident, queue, relationship strength, or event history.

## Long-horizon runner

`src/scenario-runner.js` starts a clean staging seed and advances through `advanceTown`; it does not maintain a parallel fake engine. The CLI runs requested checkpoints such as 1, 7, 30, and 90 simulated days in daily batches while the engine still processes every plan and queued action at its actual timestamp.

Each report includes:

- event counts and per-resident plan/action totals;
- action distribution and activity by location;
- relationship changes and largest gains/losses;
- commitments created, fulfilled, delayed, broken, open, and highest generation;
- model attempts, successful calls, fallbacks, cost skips, and token totals;
- reflection attempts, applied notes, fallbacks, and provider token/cache totals when an opt-in reflection adapter is supplied;
- min/max energy and hunger over the whole run;
- duplicate IDs, invalid references, overdue open commitments, due queue entries, need bounds, and obvious rest/no-activity loops.
- repeated per-resident daily patterns, event-template concentration, relationship direction/saturation, social encounter coverage, any-causal-activity coverage, personal meaningful-history counts, and resident participation by place.

The seed, start time, authored rules, and deterministic adapter make a replay comparable across code changes. Reports contain no wall-clock timestamps or random values.

## Model policy

The adapter is eligible only for the current Sal commitment experiment, and only when two or more actionable commitments can expire before his next planning turn. One obvious commitment, impossible action under hard need, and routine life stay scripted. The model receives a compact authoritative snapshot at Sal's actual planning instant, including each offered deadline, current relationship strength and tension, exact deterministic relationship deltas, and bounded downstream civic effect. It returns JSON with a small output budget and has a typed timeout/provider/validation failure path. A fallback plan is selected by deterministic rules. Usage and fallback status become projection statistics and events.

`advanceTown` and the scenario runner are asynchronous, but there is still one authoritative execution path. Deterministic adapters resolve immediately; paid adapters are awaited before validation and queueing. The engine therefore cannot prefetch intent from stale state while other residents, needs, expiries, or relationship changes are still pending before the planning turn.

Provider pricing policy uses injected real wall-clock time. Calder Station's simulated date never determines whether a call is peak-priced. Routine autonomous calls are skipped during DeepSeek's published weekday 01:00–04:00 and 06:00–10:00 UTC peak windows; deliberate evaluation has an explicit bypass. Time injection keeps normal tests independent of the actual hour. As verified on 2026-08-30, `deepseek-v4-flash` is $0.22/M cache-miss input and $0.66/M output tokens off-peak, with peak rates twice those amounts.

Resident planning slots span the entire simulated day. They never move to accommodate provider pricing; only the real request boundary applies the cost policy.

`src/hybrid-planner.js` is the single scripted/model selection boundary used by both the persistent object and evaluation. The deliberate local matrix creates fresh conflicts and varies deadlines, trust, tension, location, and fatigue. Staging starts identical scripted and model-assisted towns with one impossible Day-1 conflict, runs both for 90 days through `runScenario`, and records checkpoint, relationship, civic-chain, token, cost, and bounded causal-event differences. Neither path has a separate evaluation engine.

Staging has a fixed evaluation revision and a server-side quarter-hour Cron trigger. The 90-day baseline and assisted season are advanced through the same `runScenario` engine in seven-day chunks, with the full resumable run snapshot stored in a staging-only SQLite table. The Worker cron handler orchestrates bounded internal requests; each chunk executes inside the staging Durable Object, so the evaluation does not depend on a paid-only Worker CPU setting and the full snapshot never crosses the public API. If a runtime or deployment interrupts it, the next trigger resumes after the last persisted chunk. A stale free `baseline-running` lease may retry because it cannot spend money. Assisted provider choices are staged in a revision-scoped Durable Object storage ledger before the request and after a valid result; a replay reuses a completed choice, while an outcome-unknown pending choice falls back without another request. `assisted-running` is safe to resume only when its snapshot exists; an interrupted paid phase without a snapshot remains terminal, so an unknown provider response cannot be bought twice. `failed` and `complete` are terminal. Retrying a terminal paid phase deliberately requires a new revision. Production declares no evaluation trigger. The public staging API can read the report but cannot trigger, reset, or configure paid calls. Because Worker secrets are environment-specific, staging requires its own `DEEPSEEK_API_KEY`; post-deploy smoke verification requires `modelReady: true`.

The staging deployment polls that read-only report for up to 45 minutes, enough for the normal two-phase run and a bounded recovery tick. Terminal failure or a stranded paid lease makes the deployment red; completion prints the bounded report into the GitHub Actions record. This is observation, not a second trigger, so deployment retries cannot initiate extra provider calls for the same revision.

Routine mechanics remain scripted. More model-eligible incident classes should wait until the first one is easy to explain from the event history and long-horizon reports.

## Reflection slice (staging only)

The first higher-order reflection experiment is deliberately narrower than the
existing commitment evaluator. `src/reflections.js` defines a configurable
cadence (`disabled`, `accelerated`, or `fast_test`) and one bounded field:
`{focusTargetId, note}`. A focus must name an existing relationship and the note
is capped at 160 characters. The engine records the reflection, then lets the
ordinary planner use that focus to reserve one legal visit in its existing
finite queue. A target is never moved or guaranteed to be present; normal
co-location, wakefulness, travel, and daily-encounter rules still decide the
outcome. Provider failure records a null-focus fallback and continues normally.

`src/deepseek-reflection.js` supplies the optional DeepSeek adapter with compact
resident, relationship, obligation, and recent-event context. It cannot author
actions, destinations, timing, or consequences. `src/reflection-evaluation.js`
provides a tiny two-resident staging fixture and runs baseline and assisted arms
through the same `runScenario` engine. The default CLI mode is deterministic and
free; the staging workflow explicitly runs the same harness once with the live
DeepSeek adapter and uploads the bounded JSON report. The slice is never wired
into the production alarm or the deployed V11 commitment revision.

## Viewer

The Folio UI is a read-only register, not an operations console. It shows the current hour, journal, places, people, relationships, queued actions, recent records, and bounded personal turning points. Portrait assets are part of the resident identity presentation. The map is a separate route over the same projection, and browser routes are served by the static Worker asset layer.

Polling remains once per minute. WebSockets, controls that mutate the town, and a second frontend generation are deferred until a concrete need appears.

## Deferred infrastructure

One coordinator plus embedded SQLite is enough for the current town. D1 is appropriate later for shared analytics or cross-town queries; Queues or Workflows are appropriate when real fan-out or durable multi-step work exists. Neither is justified by population alone.
