# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

The repository is deliberately small, but Rookwood is now persistent: one SQLite-backed Cloudflare Durable Object owns its projection, bounded event reads, and hourly heartbeat. The deterministic simulation remains the authority and the public site is a read-only window into it. The ephemeral preview stays fully deterministic; the persistent alarm has one bounded DeepSeek experiment for Sal Orin's seeded obligation when `DEEPSEEK_API_KEY` is configured.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.
- The dashboard is read-only until the simulation and event model are trustworthy.
- The preview is reproducible and makes zero model calls; the persistent experiment is separately gated and observable.
- A model may propose only a structured plan; deterministic validation and consequences decide what enters the world.

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

The current seed contains fifteen residents, fourteen locations, twenty-seven relationship edges, and one obligation. Each resident has a home, workplace, routine, needs, and a staggered plan slot. The scripted planner returns one bounded daily action plus an optional social intention; the simulation validates and resolves it, and accepted actions, encounters, or obligation outcomes become compact events.

The persistent town currently gives DeepSeek exactly one meaningful choice: Sal must decide whether to fulfill Vey's sealed notice or report a delay. That request is made only when Sal's scheduled turn is due and the obligation is still open. It uses a small JSON response budget, no retry loop, a strict validator, and the same scripted decision as a fallback. Usage, fallback, and outcome are recorded in the projection so the experiment can be judged rather than hand-waved.

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
- `src/obligations.js` — seeded obligation state, fallback decision, and deterministic consequences.
- `src/deepseek-planner.js` — bounded DeepSeek adapter; it returns plans and never mutates town state.
- `src/social.js` — deterministic co-location and relationship resolver.
- `src/demo-data.js` — the fifteen-resident Rookwood seed and compact test seed.
- `public/` — the static dashboard shell and client-side routes.
- `test/` — scheduler, simulation, migration, Durable Object, API, and routing tests.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## Deploy from GitHub

The manual GitHub Actions workflow creates or updates the `town-dashboard` Worker and its `RookwoodTown` Durable Object after these repository secrets exist:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run **Deploy Town Dashboard** from the repository's Actions tab. The dashboard never receives the model key. The persistent alarm reads the Cloudflare Worker secret `DEEPSEEK_API_KEY`; if it is absent, Rookwood remains entirely scripted. An optional `DEEPSEEK_MODEL` runtime variable selects another compatible model, otherwise the adapter uses `deepseek-v4-flash`.

## What comes next

The next useful step is observation: let the persistent town cross Sal's scheduled turn, inspect whether the model or fallback resolved the obligation, and compare the resulting event and relationship change. Do not add another model-eligible incident until this one is easy to explain and test. D1 remains unnecessary until cross-town queries or administration create a real need for it.
