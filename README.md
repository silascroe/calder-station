# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, commitments, and consequences that continue while nobody is looking.

The public world is **Calder Station**. Its stable internal world and storage key remain `rookwood` so the existing production Durable Object is not orphaned by an editorial rename. That implementation detail is not part of the town's public identity.

## Design constraints

- Residents are durable records, not permanently running processes.
- Ordinary simulation mechanics are deterministic, bounded, and cheap.
- A model proposes structured intent; the simulation owns legality, timing, state, and consequences.
- A plan can enqueue several bounded actions, but the queue cannot create an unbounded thought or conversation loop.
- Model failures fall back to scripted rules and record the fallback.
- The town remains inspectable through an append-only event history and replayable seeds.
- Production state is persistent and protected from casual resets; staging is isolated and disposable.
- The dashboard is a read-only window into the town, not a second simulation engine.
- D1, Queues, and Workflows remain deferred until this one coordinator has a concrete need for them.

## Run tests

```sh
npm test
```

The current tests use Node's built-in test runner and do not need dependencies installed.

## Run a long-horizon scenario

The scenario runner starts a fresh in-memory staging town and uses the same `advanceTown` rules as production. It does not touch Cloudflare state and does not change the public `?ticks=` limit.

```sh
npm run scenario -- --days 1,7,30,90
npm run scenario -- --days 90 --seed another-replay --json
```

Reports include event counts, plans and actions per resident, relationship deltas, obligation outcomes and generations, activity by place, model telemetry, need ranges, queue state, and invariant/stuck-state checks.

## Run the dashboard locally

```sh
npx wrangler dev
```

The Worker serves the Folio register and read-only routes for `/`, `/map`, `/residents`, and `/residents/:id`. Explicit `?ticks=` requests remain ephemeral replays for inspection and are capped at 48 ticks.

## Current simulation

Calder Station has fifteen residents, fourteen places, twenty-seven relationship edges, and one renewable courier commitment. Each resident receives a staggered daily planning turn. The scripted planner returns a short ordered list of work, meals, rest, deliveries, or observation; the deterministic executor schedules those intentions through the day, interrupts them when a new plan or urgent need requires it, and records each accepted action.

The first model experiment is deliberately narrow: Sal D’Amico may use DeepSeek for the open commitment involving Jamie Allen's notice. The adapter sends bounded context, requires one legal choice, and returns the same plan contract as the scripted planner. The model never writes state directly.

The commitment loop can create a follow-up notice after a fulfillment, delay, or missed due time. Relationship strength changes with the outcome, and the series is capped so a bad rule cannot grow forever.

The compact `tinyTownSeed` remains available for fast regression tests.

## Environments and deployment

The manual GitHub Actions workflow accepts a deployment target:

- `staging` deploys `town-dashboard-staging` and uses the isolated `rookwood-staging` Durable Object key.
- `production` deploys `town-dashboard` and preserves the canonical persistent `rookwood` key.

Both targets use the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Store `DEEPSEEK_API_KEY` as a Cloudflare Worker secret in the environment that should make model calls; it is never sent to the browser. Production and staging secrets are separate when set with Wrangler's environment flag.

The workflow is intentionally manual. Deploying production or staging is an operator decision, not a side effect of a code commit.

## Repository layout

- `src/simulation.js` — state creation, the bounded action queue, execution, replay, and projections.
- `src/daily-plans.js` — versioned plan contract and validator.
- `src/scripted-decisions.js` — ordinary rule-based intent with no model calls.
- `src/obligations.js` — commitment resolution, expiry, and bounded renewal.
- `src/scenario-runner.js` — long-horizon diagnostics and invariant checks.
- `src/town-do.js` — one SQLite-backed Durable Object coordinator and hourly alarm.
- `src/deepseek-planner.js` — bounded DeepSeek adapter with typed failures.
- `src/social.js` — deterministic co-location and relationship resolver.
- `src/demo-data.js` — authored Calder Station seed and compact regression seed.
- `src/identity.js` — public identity plus one-time historical migration helpers.
- `public/` — Folio dashboard, map, resident register, and portrait assets.
- `test/` — unit, integration, migration, replay, runner, and frontend contract tests.
- `docs/architecture.md` — system boundaries and decisions.
- `plan.md` — sequencing and deferred work.
