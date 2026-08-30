# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

This repository is deliberately at the foundation stage. It does not call an AI API or pretend that a collection of prompts is a society. It now includes a tiny Cloudflare Worker and dashboard shell so the project has a visible front door while the simulation is still being built.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.
- The dashboard is read-only until the simulation and event model are trustworthy.

## Run the tests

```sh
npm test
```

There are no dependencies to install for the current foundation.

## Run the dashboard locally

```sh
npx wrangler dev
```

The local Worker serves the dashboard and its demo API. The current shell has routes for `/`, `/map`, `/residents`, and individual resident pages. It is intentionally demo data, not a running town.

## Repository layout

- `src/scheduler.js` — pure scheduling policy; no network or platform code.
- `src/worker.js` — the Cloudflare Worker entry point and demo read-only API.
- `src/demo-data.js` — temporary three-resident fixture data for the dashboard.
- `public/` — the static dashboard shell and client-side routes.
- `test/scheduler.test.js` — executable examples for peak-hour deferral and staggered daily decisions.
- `test/worker.test.js` — API and asset-routing tests for the Worker entry point.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## Deploy from GitHub

The manual GitHub Actions workflow creates or updates the `town-dashboard` Worker after these repository secrets exist:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run **Deploy Town Dashboard** from the repository's Actions tab. The DeepSeek key is not used by this dashboard shell yet; add it later as the Cloudflare Worker secret `DEEPSEEK_API_KEY` when the model adapter exists.

## What comes next

The next useful slice is a deterministic world state with an event log and a mock decision adapter. The dashboard should then read that event log instead of the fixture. Only after that should the project add resident memory and a real model client. The model should plug into the simulation rather than become the simulation.
