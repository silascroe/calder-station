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

## What is deliberately true now

Ordinary code owns time, needs, locations, queues, legality, movement, relationships, obligations, and consequences. The model may propose a bounded intent but cannot write world state. The dashboard reads projections and events; it does not contain simulation rules.

The action queue is intentionally finite: each plan has at most five actions, each action is scheduled within one day, and a new planning turn can supersede unfinished work. Renewable commitments have an open-count and generation cap. Those caps are part of the design, not temporary hopes.

## Next useful work

1. Run fresh staging scenarios after rule changes and compare checkpoint reports.
2. Inspect whether the commitment series creates understandable relationship and resource consequences rather than noise.
3. Improve the deterministic world mechanics only where the reports expose a real missing cause: small resources, travel time, health, or work output may be candidates.
4. Expand model participation only after a second incident class has a deterministic success criterion and a bounded fallback.
5. Add deeper memory only when residents need selective beliefs or witnessed history that the current projection cannot explain.

## Deferred

- No population expansion until current mechanics and the viewer can explain a long run.
- No full economy, market, procedural story generator, or unbounded conversation loop.
- No D1, Queues, Workflows, or one-object-per-resident design without a concrete contention, fan-out, or cross-town query.
- No automatic production reset, merge, publish, or other irreversible side effect.
- No WebSockets while one-minute polling is sufficient.
