# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

The repository is deliberately small, but Rookwood is now persistent: one SQLite-backed Cloudflare Durable Object owns its projection, bounded event reads, and hourly heartbeat. The deterministic simulation remains the authority and the public site is a read-only window into it. No AI API is called yet.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.
- The dashboard is read-only until the simulation and event model are trustworthy.
- The current scripted simulation is reproducible and makes zero model calls.

## Run the tests

```sh
npm test
```

There are no dependencies to install for the current foundation.

## Run the dashboard locally

```sh
npx wrangler dev
```

The local Worker serves the town view and API. With local Durable Object storage enabled, `/api/town` initializes Rookwood and schedules its heartbeat. Routes exist for `/`, `/map`, `/residents`, and individual resident pages. Explicit `?ticks=` requests remain ephemeral replays for inspection and tests.

## Current simulation slice

The current seed contains fifteen residents, fourteen locations, and twenty-seven relationship edges. Each resident has a home, workplace, routine, needs, and a staggered plan slot. The scripted planner returns one bounded daily action plus an optional social intention; the simulation validates and resolves it, and accepted actions or encounters become compact events.

Persisted towns reconcile idempotently with the authored seed. Adding a resident or place updates an existing Rookwood without replacing evolved state or history. Event IDs use the projection's monotonic count, so the town can advance without loading its entire history into memory; viewer reads are capped and newest-first.

The preview records a seed as replay metadata, but does not use randomness yet. That is deliberate: deterministic rules are easier to inspect and test before stochastic variation is introduced.

For inspection, the preview length can be changed without mutating the town:

```text
/api/town?ticks=0
/api/events?ticks=12
```

The API accepts `ticks` from `0` through `48`. The `tinyTownSeed` remains available as a compact three-resident regression scenario.

## Repository layout

- `src/scheduler.js` — pure scheduling policy; no network or platform code.
- `src/worker.js` — the Cloudflare Worker entry point and API router.
- `src/town-do.js` — the SQLite-backed town coordinator and alarm heartbeat.
- `src/simulation.js` — state creation, ticking, event creation, replay, and API projections.
- `src/scripted-decisions.js` — ordinary rule-based action policy; no model calls.
- `src/daily-plans.js` — versioned planner contract and validator.
- `src/social.js` — deterministic co-location and relationship resolver.
- `src/demo-data.js` — the fifteen-resident Rookwood seed and compact test seed.
- `public/` — the static dashboard shell and client-side routes.
- `test/` — scheduler, simulation, migration, Durable Object, API, and routing tests.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## Deploy from GitHub

The manual GitHub Actions workflow creates or updates the `town-dashboard` Worker and its `RookwoodTown` Durable Object after these repository secrets exist:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run **Deploy Town Dashboard** from the repository's Actions tab. The DeepSeek key is not used by this dashboard shell yet; add it later as the Cloudflare Worker secret `DEEPSEEK_API_KEY` when the model adapter exists.

## What comes next

The next useful domain slice is one model-backed resident behind a strict timeout, token budget, retry limit, and scripted fallback. D1 remains unnecessary until cross-town queries or administration create a real need for it.
