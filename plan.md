# Town plan

This is a direction document, not a promise to build every item immediately. Calder Station should remain small, deterministic, inspectable, and cheap while the simulation earns more complexity.

## Current milestone — long-horizon simulation

- Keep the fifteen-resident Calder Station seed and the compact three-resident regression seed.
- Keep one town coordinator and separate staging/production Durable Object state.
- Use the version 2 plan contract and bounded intra-day action queue.
- Exercise the same engine through 1-, 7-, 30-, and 90-day staging scenario reports.
- Maintain one narrow renewable commitment series so consequences can create later situations.
- Keep DeepSeek limited to the existing Sal commitment experiment until reports show that it adds understandable value.

Success means a fresh staging Calder Station can run for 90 simulated days, produce replayable diagnostics, and show accumulated causal differences rather than ninety identical daily snapshots.

## Senior review evidence — 2026-08-30

- The deployed staging Worker is currently ephemeral: its named Wrangler environment omitted the non-inherited `TOWN` binding. The repository fix now declares the binding explicitly, rejects configured Workers that lack it, validates deployment configuration, and smoke-tests persistence after deployment. Staging still needs redeployment before this is true live.
- The deterministic baseline is stable but repetitive. At Day 90 it produces 6,176 events and healthy bounds, but most residents have only 7–11 distinct daily action signatures, relationship change is entirely net-positive, social activity reaches only 13 of 27 ties, and one Sal/Jamie series accounts for 56 near-identical commitments.
- A Day 365 audit remains healthy but confirms the structural ceiling: the commitment series stops at generation 90, five relationships saturate at 100, none end below their starting value, and resident histories remain dominated by routine movement/eat/work/rest templates. Long-horizon reports now measure those failure modes directly.
- The simulation and long-horizon runner now share an asynchronous planner boundary. Model intent is requested at the exact authoritative planning instant rather than prefetched from state at the beginning of an hourly alarm. Deterministic CI remains no-cost; deliberate paid staging evaluation is the next evidence layer.
- Current DeepSeek documentation lists weekday peak windows at 01:00–04:00 and 06:00–10:00 UTC, with off-peak pricing at half the peak rate. Scheduled production calls should retain that policy; deliberate evaluation needs an explicit bypass.
- A fixed 24-case paid evaluation matrix now uses the same authoritative planner, validator, queue, and executor as the town. It varies needs, location, trust, and deadline pressure, records intent versus executed outcome, and estimates cost from cache-aware token usage. Staging runs each revision once from a server-side schedule; no public route can initiate paid work.
- This workspace has no DeepSeek or Cloudflare credential. Production health confirms its Worker has a model secret, but Cloudflare secrets are not inherited by staging. Genuine results remain blocked until the staging secret is configured and the corrected staging build is deployed.

## What is deliberately true now

Ordinary code owns time, needs, locations, queues, legality, movement, relationships, obligations, and consequences. The model may propose a bounded intent but cannot write world state. The dashboard reads projections and events; it does not contain simulation rules.

The action queue is intentionally finite: each plan has at most five actions, each action is scheduled within one day, and a new planning turn can supersede unfinished work. Renewable commitments have an open-count and generation cap. Those caps are part of the design, not temporary hopes.

## Next useful work

1. Redeploy and verify persistent staging without touching production state.
2. Configure the staging-only DeepSeek secret, redeploy staging, and collect the fixed genuine evaluation report.
3. Replace the mechanical notice conveyor with the smallest conflict/resource mechanics that create explainable positive and negative downstream consequences.
4. Expose meaningful longitudinal changes through the Folio rather than adding internal counters to the public surface.

## Deferred

- No population expansion until current mechanics and the viewer can explain a long run.
- No full economy, market, procedural story generator, or unbounded conversation loop.
- No D1, Queues, Workflows, or one-object-per-resident design without a concrete contention, fan-out, or cross-town query.
- No automatic production reset, merge, publish, or other irreversible side effect.
- No WebSockets while one-minute polling is sufficient.
