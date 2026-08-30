# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

This repository is deliberately at the foundation stage. It does not call an AI API or pretend that a collection of prompts is a society. It now includes a small deterministic simulation, a read-only event feed, and a Cloudflare dashboard so the project has a visible front door while persistence and model decisions are still being built.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.
- The dashboard is read-only until the simulation and event model are trustworthy.
- The current scripted preview is reproducible and makes zero model calls.

## Run the tests

```sh
npm test
```

There are no dependencies to install for the current foundation.

## Run the dashboard locally

```sh
npx wrangler dev
```

The local Worker serves the dashboard and its read-only simulation API. The current shell has routes for `/`, `/map`, `/residents`, and individual resident pages. The API renders the same seeded first-day preview on each request; it is not persistent yet.

## Current simulation slice

The first slice runs ten residents through a deterministic first-day preview. Each resident receives a staggered routine decision slot, returns a scripted intent, moves if necessary, and updates bounded needs such as energy and hunger. Eleven locations give the town a few distinct places to go, and twelve seeded relationships provide a social graph for later rules. Accepted actions become compact events. The dashboard reads a state projection and newest-first event feed from `/api/town` and `/api/events`.

The preview records a seed as replay metadata, but does not use randomness yet. That is deliberate: deterministic rules are easier to inspect and test before stochastic variation is introduced.

For inspection, the preview length can be changed without mutating the town:

```text
/api/town?ticks=0
/api/events?ticks=12
```

The API accepts `ticks` from `0` through `48`. This is an ephemeral preview, so reloading the page recomputes the same state rather than advancing a remote town. The `tinyTownSeed` remains available to tests as a compact three-resident scenario.

## Repository layout

- `src/scheduler.js` — pure scheduling policy; no network or platform code.
- `src/worker.js` — the Cloudflare Worker entry point and read-only simulation API.
- `src/simulation.js` — state creation, ticking, event creation, replay, and API projections.
- `src/scripted-decisions.js` — ordinary rule-based game AI; no model calls.
- `src/demo-data.js` — the ten-resident Rookwood seed and compact test seed.
- `public/` — the static dashboard shell and client-side routes.
- `test/scheduler.test.js` — executable examples for peak-hour deferral and staggered daily decisions.
- `test/simulation.test.js` — replay, scheduling, event, and state-invariant tests.
- `test/worker.test.js` — API and asset-routing tests for the Worker entry point.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## Deploy from GitHub

The manual GitHub Actions workflow creates or updates the `town-dashboard` Worker after these repository secrets exist:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run **Deploy Town Dashboard** from the repository's Actions tab. The DeepSeek key is not used by this dashboard shell yet; add it later as the Cloudflare Worker secret `DEEPSEEK_API_KEY` when the model adapter exists.

## What comes next

The next useful slice is durable storage: persist the event log and current projection in D1, then give one coordinator a heartbeat without putting world rules in the request handler. Relationships are data for now; social actions should come only after the persistent event loop can record and replay them. Only after replay and persistence are solid should one resident receive a real DeepSeek decision adapter. The model should plug into the simulation rather than become the simulation.
