# Town

Town is an experiment in persistent multi-agent simulation: a small world with residents, routines, relationships, resources, and consequences that continue while nobody is looking.

This repository is deliberately at the foundation stage. It does not call an AI API, deploy to Cloudflare, or pretend that a collection of prompts is a society. The first piece is a small, tested scheduling policy for future model decisions.

## Design constraints

- Residents are durable state, not permanently running processes.
- Ordinary simulation mechanics should be deterministic and cheap.
- A model is consulted for meaningful decisions, not every clock tick.
- Routine decisions are spread across the day and delayed out of DeepSeek's published UTC peak windows.
- Urgent decisions may run immediately; the scheduler is a cost policy, not a gag order.
- Every future side effect should be validated by the simulation before it changes world state.
- The town should remain interesting with a small population. Bigger is not automatically better.

## Run the tests

```sh
npm test
```

There are no dependencies to install for the current foundation.

## Repository layout

- `src/scheduler.js` — pure scheduling policy; no network or platform code.
- `test/scheduler.test.js` — executable examples for peak-hour deferral and staggered daily decisions.
- `docs/architecture.md` — the boundary between deterministic simulation, model decisions, memory, and infrastructure.

## What comes next

The next useful slice is a deterministic world state with an event log and a mock decision adapter. Only after that should the project add resident memory, a real model client, and Cloudflare persistence. The model should plug into the simulation rather than become the simulation.
