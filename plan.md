# Town plan

This is a direction document, not a promise to build every item immediately. Calder Station should remain small, deterministic, inspectable, and cheap while the simulation earns more complexity.

## Current milestone — long-horizon simulation

- Keep the fifteen-resident Calder Station seed and the compact three-resident regression seed.
- Keep one town coordinator and separate staging/production Durable Object state.
- Use the version 2 plan contract and bounded intra-day action queue.
- Exercise the same engine through 1-, 7-, 30-, and 90-day staging scenario reports.
- Maintain four narrow authored civic commitment chains so consequences can create later situations without becoming a procedural story generator.
- Keep DeepSeek limited to the existing Sal commitment experiment until reports show that it adds understandable value.

Success means a fresh staging Calder Station can run for 90 simulated days, produce replayable diagnostics, and show accumulated causal differences rather than ninety identical daily snapshots.

## Senior review evidence — 2026-08-30

- The deployed staging Worker is currently ephemeral: its named Wrangler environment omitted the non-inherited `TOWN` binding. The repository fix now declares the binding explicitly, rejects configured Workers that lack it, validates deployment configuration, and smoke-tests persistence after deployment. Staging still needs redeployment before this is true live.
- The deterministic baseline is stable but repetitive. At Day 90 it produces 6,176 events and healthy bounds, but most residents have only 7–11 distinct daily action signatures, relationship change is entirely net-positive, social activity reaches only 13 of 27 ties, and one Sal/Jamie series accounts for 56 near-identical commitments.
- A Day 365 audit remains healthy but confirms the structural ceiling: the commitment series stops at generation 90, five relationships saturate at 100, none end below their starting value, and resident histories remain dominated by routine movement/eat/work/rest templates. Long-horizon reports now measure those failure modes directly.
- Four authored civic chains now distribute consequential commitments across existing relationships and underused places. Follow-ups carry parent IDs; delays retry; failures end a cycle until cooldown. Relationship tension and diminishing gains make outcomes non-monotonic. Bounded social calls raise conversational coverage to 23 of 27 ties by Day 90 and 25 by Day 365; the two remaining ties participate through civic obligations, so all 27 have causal activity. Two relationships remain weaker at Day 365 and none saturate.
- The Folio now separates consequential history from ordinary routine, shows open commitments and their lineage, and gives each relationship both its current strength and change from baseline. The public surface still avoids model telemetry and diagnostic counters.
- The simulation and long-horizon runner now share an asynchronous planner boundary. Model intent is requested at the exact authoritative planning instant rather than prefetched from state at the beginning of an hourly alarm. Deterministic CI remains no-cost; deliberate paid staging evaluation is the next evidence layer.
- Current DeepSeek documentation lists weekday peak windows at 01:00–04:00 and 06:00–10:00 UTC, with off-peak pricing at half the peak rate. Scheduled production calls should retain that policy; deliberate evaluation needs an explicit bypass.
- A fixed 24-case paid evaluation matrix now uses the same authoritative planner, validator, queue, and executor as the town. It varies needs, location, trust, and deadline pressure, records intent versus executed outcome, and estimates cost from cache-aware token usage. Staging runs each revision once from a server-side schedule; no public route can initiate paid work.
- This workspace has no local DeepSeek or Cloudflare credential. The operator reports that the staging Worker now has its own DeepSeek secret; genuine results remain pending until the corrected staging build is deployed and its server-side evaluation runs. No paid calls have been made in this pass yet.
- DeepSeek's authority is now choice-only: `{obligationId, choice, note}`. It may choose among bounded open commitments when they genuinely compete, while deterministic code composes Sal's full legal day and leaves unattended commitments subject to their deadlines.
- Persistent history now orders by durable insertion rather than lexical IDs and repairs a stale projection event sequence from SQLite, covering the first concrete year-scale log defect found in the operations audit.
- `main` now automatically deploys disposable staging after the test gate; production remains manual. This removes the recurring evaluation bottleneck without allowing code pushes to touch canonical production state.
- Resident schedules now span the fictional day independently of provider price windows. Persistent operation explicitly pauses on downtime, guards alarm retries against double advancement, and guards exact planning instants against duplicate model spend. The paid evaluator writes a running lease and never auto-retries a failed or interrupted revision.
- Caught alarm failures are health-visible and schedule a fresh attempt one hour later, so Cloudflare's finite automatic retry budget cannot quietly stop the town forever.

## What is deliberately true now

Ordinary code owns time, needs, locations, queues, legality, movement, relationships, obligations, and consequences. The model may propose a bounded intent but cannot write world state. The dashboard reads projections and events; it does not contain simulation rules.

The action queue is intentionally finite: each plan has at most five actions, each action is scheduled within one day, and a new planning turn can supersede unfinished work. Renewable commitments have an open-count and generation cap. Those caps are part of the design, not temporary hopes.

## Next useful work

1. Redeploy staging with its configured DeepSeek secret, verify persistent mode, and collect the fixed genuine evaluation report without touching production state.
2. Use genuine evaluation results to decide whether the Sal conflict earns model calls or needs stronger pressure.
3. Use the Folio and model report together to decide whether the next phase should deepen durable relationship memory or introduce a second model-worthy conflict class.

## Deferred

- No population expansion until current mechanics and the viewer can explain a long run.
- No full economy, market, procedural story generator, or unbounded conversation loop.
- No D1, Queues, Workflows, or one-object-per-resident design without a concrete contention, fan-out, or cross-town query.
- No automatic production reset, merge, publish, or other irreversible side effect.
- No WebSockets while one-minute polling is sufficient.
