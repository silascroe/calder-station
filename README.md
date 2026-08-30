# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

The repository is still deliberately small, but it now has a persistent boundary: one SQLite-backed Cloudflare Durable Object can own Rookwood's state, event log, and heartbeat. The deterministic scripted simulation remains the authority, and the dashboard remains a read-only window into it. No AI API is called yet.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.
- The dashboard is read-only until the simulation and event model are trustworthy.
- The current scripted simulation makes zero model calls.

## Run the tests

```sh
npm test
```

There are no dependencies to install for the current foundation.

## Run the dashboard locally

```sh
npx wrangler dev
```

The local Worker serves the dashboard and its API. With the Durable Object binding enabled, the first request to `/api/town` initializes local Rookwood storage and schedules its heartbeat. The alarm advances the scripted town by one simulated hour every wall-clock hour. Local Durable Object data is managed by Wrangler and is not committed.

The dashboard has routes for `/`, `/map`, `/residents`, and individual resident pages. The default API reads the persistent town when the `TOWN` binding exists. Adding `ticks` explicitly selects the old ephemeral preview path:

```text
/api/town?ticks=0
/api/events?ticks=12
```

The API accepts `ticks` from `0` through `48`. The `tinyTownSeed` remains available to tests as a compact three-resident scenario.

## Current simulation slice

The deterministic Rookwood seed contains ten residents, eleven locations, and twelve seeded relationship edges. Each resident receives a staggered routine decision slot, returns a scripted intent, moves if necessary, and updates bounded needs such as energy and hunger. Accepted actions become compact events.

The preview records a seed as replay metadata, but does not use randomness yet. That is deliberate: deterministic rules are easier to inspect and test before stochastic variation is introduced.

## Persistent town slice

`RookwoodTown` is one SQLite-backed Durable Object for the entire town, not one object per resident. It stores the current projection in `town_state` and the append-only event records in `town_events`. Its alarm wakes it once per hour, advances the ordinary simulation, persists the result, and schedules the next alarm.

The Worker routes the normal `/api/town`, `/api/events`, and `/api/health` reads through that object when deployed with the binding. Requests with `ticks` remain an explicit, safe way to inspect a fresh replay without mutating the persistent town.

## Repository layout

- `src/scheduler.js` — pure scheduling policy; no network or platform code.
- `src/worker.js` — the Cloudflare Worker entry point and API router.
- `src/town-do.js` — the SQLite-backed Rookwood coordinator and alarm heartbeat.
- `src/simulation.js` — state creation, ticking, event creation, replay, and API projections.
- `src/scripted-decisions.js` — ordinary rule-based game AI; no model calls.
- `src/demo-data.js` — the ten-resident Rookwood seed and compact test seed.
- `public/` — the static dashboard shell and client-side routes.
- `test/` — scheduler, simulation, Worker, and Durable Object boundary tests.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## Deploy from GitHub

The manual GitHub Actions workflow creates or updates the `town-dashboard` Worker and provisions the `RookwoodTown` SQLite-backed Durable Object after these repository secrets exist:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run **Deploy Town Dashboard** from the repository's Actions tab. Deployment is still manual by design. The DeepSeek key is not used by this slice; keep it as the Cloudflare Worker secret `DEEPSEEK_API_KEY` for the future model adapter.

## What comes next

The next useful domain slice is a daily-plan interface that both scripted game AI and a future DeepSeek planner can implement. D1 remains optional until the project needs cross-town queries, analytics, or administration. The model should plug into the simulation rather than become the simulation.

