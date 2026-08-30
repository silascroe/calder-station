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
- The synchronous runner does not exercise DeepSeek, and the persistent adapter currently requests a plan before the engine reaches the exact planning instant. The next architecture layer is an asynchronous planning boundary at authoritative simulated time, followed by deliberate paid staging evaluation.
- Current DeepSeek documentation lists weekday peak windows at 01:00–04:00 and 06:00–10:00 UTC, with off-peak pricing at half the peak rate. Scheduled production calls should retain that policy; deliberate evaluation needs an explicit bypass.

## What is deliberately true now

Ordinary code owns time, needs, locations, queues, legality, movement, relationships, obligations, and consequences. The model may propose a bounded intent but cannot write world state. The dashboard reads projections and events; it does not contain simulation rules.

The action queue is intentionally finite: each plan has at most five actions, each action is scheduled within one day, and a new planning turn can supersede unfinished work. Renewable commitments have an open-count and generation cap. Those caps are part of the design, not temporary hopes.

## Next useful work

1. Redeploy and verify persistent staging without touching production state.
2. Move model planning to the exact authoritative planning instant and add an async same-engine scenario path.
3. Run enough genuine DeepSeek cases to measure validity, choice distribution, token use, cost, and sensitivity to changed circumstances.
4. Replace the mechanical notice conveyor with the smallest conflict/resource mechanics that create explainable positive and negative downstream consequences.
5. Expose meaningful longitudinal changes through the Folio rather than adding internal counters to the public surface.

## Deferred

- No population expansion until current mechanics and the viewer can explain a long run.
- No full economy, market, procedural story generator, or unbounded conversation loop.
- No D1, Queues, Workflows, or one-object-per-resident design without a concrete contention, fan-out, or cross-town query.
- No automatic production reset, merge, publish, or other irreversible side effect.
- No WebSockets while one-minute polling is sufficient.
