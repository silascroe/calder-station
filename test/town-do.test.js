import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";
import { createInitialTown } from "../src/simulation.js";
import { RookwoodTown } from "../src/town-do.js";

class Cursor {
  constructor(rows = []) { this.rows = rows; }
  toArray() { return this.rows; }
}

class FakeSql {
  stateRow = null;
  eventRows = new Map();

  exec(query, ...bindings) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) return new Cursor();
    if (normalized.startsWith("SELECT state_json FROM town_state")) return new Cursor(this.stateRow ? [this.stateRow] : []);
    if (normalized.startsWith("SELECT id, event_json FROM town_events")) {
      return new Cursor([...this.eventRows.values()].map(({ id, event_json }) => ({ id, event_json })));
    }
    if (normalized.startsWith("SELECT event_json FROM town_events")) {
      const limit = bindings[0] ?? Number.POSITIVE_INFINITY;
      const descending = normalized.includes("ORDER BY at DESC");
      const rows = [...this.eventRows.values()].sort((left, right) => {
        const result = left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
        return descending ? -result : result;
      });
      return new Cursor(rows.slice(0, limit).map(({ event_json }) => ({ event_json })));
    }
    if (normalized.startsWith("INSERT INTO town_state")) {
      const [id, state_json, updated_at] = bindings;
      this.stateRow = { id, state_json, updated_at };
      return new Cursor();
    }
    if (normalized.startsWith("INSERT OR IGNORE INTO town_events")) {
      const [id, at, event_json] = bindings;
      if (!this.eventRows.has(id)) this.eventRows.set(id, { id, at, event_json });
      return new Cursor();
    }
    if (normalized.startsWith("UPDATE town_events SET event_json")) {
      const [event_json, id] = bindings;
      const row = this.eventRows.get(id);
      if (row) row.event_json = event_json;
      return new Cursor();
    }
    throw new Error(`Unexpected SQL in fake storage: ${normalized}`);
  }
}

class FakeStorage {
  constructor() { this.sql = new FakeSql(); this.alarmAt = null; }
  transactionSync(callback) { return callback(); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at) { this.alarmAt = at; }
}

class FakeContext {
  constructor(storage) { this.storage = storage; }
  blockConcurrencyWhile(callback) { return callback(); }
}

function makeTown(env = {}) {
  const storage = new FakeStorage();
  return { town: new RookwoodTown(new FakeContext(storage), env), storage };
}

test("the town object initializes the current persistent Calder Station", async () => {
  const { town, storage } = makeTown();
  const response = await town.fetch(new Request("https://town.internal/state"));
  const state = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.persistence, "durable-object");
  assert.equal(state.environment, "production");
  assert.equal(state.name, "Calder Station");
  assert.equal(state.residents.length, 15);
  assert.equal(state.locations.length, 14);
  assert.equal(state.relationships.length, 27);
  assert.equal(state.obligations.length, 1);
  assert.equal(state.residents.find(({ id }) => id === "mara").name, "Mara Konstantinidis");
  assert.equal(state.obligations[0].title, "Jamie's sealed notice");
  assert.equal(state.locations.find(({ id }) => id === "town-hall").name, "Calder Hall");
  assert.equal(state.stats.eventCount, 1);
  assert.equal(storage.sql.eventRows.size, 1);
  assert.ok(storage.alarmAt > Date.now());
});

test("an existing ten-person projection reconciles and renames without replacing evolved state", async () => {
  const { town, storage } = makeTown();
  const old = createInitialTown();
  old.residents = old.residents.slice(0, 10);
  old.residents.forEach((resident) => {
    resident.decisionCount = 1;
    delete resident.actionCount;
  });
  old.locations = old.locations.slice(0, 11);
  old.relationships = old.relationships.slice(0, 12);
  delete old.obligations;
  old.seedRevision = 3;
  old.name = "Rookwood";
  old.events[0].text = "Rookwood's first day began";
  old.residents[0].name = "Mara Venn";
  old.residents[0].energy = 41;
  delete old.residents[0].dailyPlan;
  delete old.residents[0].lastEncounterAt;
  delete old.residents[0].lastEncounterWithId;
  delete old.residents[0].socialCount;
  delete old.stats.planCount;
  delete old.stats.actionCount;
  delete old.stats.obligationCreatedCount;
  delete old.stats.encounterCount;
  old.stats.decisionCount = 10;
  town.persist(old);

  const response = await town.fetch(new Request("https://town.internal/state"));
  const state = await response.json();
  const mara = state.residents.find(({ id }) => id === "mara");

  assert.equal(state.residents.length, 15);
  assert.equal(state.name, "Calder Station");
  assert.equal(state.locations.length, 14);
  assert.equal(state.relationships.length, 27);
  assert.equal(state.obligations.length, 1);
  assert.equal(mara.name, "Mara Konstantinidis");
  assert.equal(mara.energy, 41);
  assert.equal(mara.socialCount, 0);
  assert.equal(state.obligations[0].title, "Jamie's sealed notice");
  assert.equal(JSON.parse(storage.sql.eventRows.get("event-0001").event_json).text, "Calder Station's first day began");
  assert.equal(state.environment, "production");
  assert.ok(state.residents.some(({ id }) => id === "edda"));
  assert.equal(state.stats.eventCount, 2);
  assert.equal(state.stats.planCount, 10);
  assert.equal(state.stats.actionCount, 10);
  assert.equal(state.stats.obligationCreatedCount, 1);
  assert.equal(storage.sql.eventRows.size, 2);
});

test("a due Sal decision uses one model plan and records its usage", async () => {
  let calls = 0;
  const { town, storage } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "chatcmpl-town-test",
        model: "deepseek-v4-flash",
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              priorities: ["fulfill the sealed notice", "keep the route intact"],
              action: "deliver",
              locationId: "town-hall",
              reason: "The notice is due before noon.",
              status: "Taking the direct route",
              mood: "Determined",
              obligationDecision: {
                obligationId: "obligation-sal-vey-notice",
                choice: "fulfill",
                note: "The direct route is still possible.",
              },
              socialIntentions: [],
            }),
          },
        }],
        usage: { prompt_tokens: 400, completion_tokens: 80, total_tokens: 480 },
      }), { status: 200 });
    },
  });
  const initial = createInitialTown();
  initial.residents.find(({ id }) => id === "sal").nextDecisionAt = "2026-08-31T00:30:00.000Z";
  town.persist(initial);

  await town.alarm();
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();

  assert.equal(calls, 1);
  assert.equal(state.stats.modelCalls, 1);
  assert.equal(state.stats.modelAttempts, 1);
  assert.equal(state.stats.modelFallbacks, 0);
  assert.equal(state.stats.modelPromptTokens, 400);
  assert.equal(state.stats.modelCompletionTokens, 80);
  assert.equal(state.obligations[0].status, "fulfilled");
  assert.equal(state.residents.find(({ id }) => id === "sal").dailyPlan.source, "model");
  assert.ok([...storage.sql.eventRows.values()].some(({ event_json }) => JSON.parse(event_json).source === "model"));
});

test("a failed model request falls back without stopping the town", async () => {
  let calls = 0;
  const { town, storage } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      calls += 1;
      throw new Error("provider unavailable");
    },
  });
  const initial = createInitialTown();
  initial.residents.find(({ id }) => id === "sal").nextDecisionAt = "2026-08-31T00:30:00.000Z";
  town.persist(initial);

  await town.alarm();
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();
  const events = [...storage.sql.eventRows.values()].map(({ event_json }) => JSON.parse(event_json));

  assert.equal(calls, 1);
  assert.equal(state.stats.modelCalls, 0);
  assert.equal(state.stats.modelAttempts, 1);
  assert.equal(state.stats.modelFallbacks, 1);
  assert.equal(state.obligations[0].status, "fulfilled");
  assert.equal(state.residents.find(({ id }) => id === "sal").dailyPlan.model.fallback, true);
  assert.ok(events.some((event) => event.type === "model-fallback" && event.reason === "network_error"));
});

test("the model experiment defers its request during a provider peak window", async () => {
  let calls = 0;
  const { town } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      calls += 1;
      throw new Error("should not be called during peak");
    },
  });
  const initial = createInitialTown();
  initial.residents.find(({ id }) => id === "sal").nextPlanAt = "2026-09-01T02:30:00.000Z";
  initial.residents.find(({ id }) => id === "sal").nextDecisionAt = "2026-09-01T02:30:00.000Z";

  const result = await town.modelPlanFor(initial, { wallClock: new Date("2026-09-01T02:00:00.000Z") });

  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("staging uses a separate durable-object storage key and mode", async () => {
  const { town, storage } = makeTown({ TOWN_ENV: "staging" });
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();

  assert.equal(state.environment, "staging");
  assert.equal(state.mode, "staging-persistent-simulation");
  assert.equal(storage.sql.stateRow.id, "rookwood-staging");
});

test("alarms advance from the projection without loading the entire event log", async () => {
  const { town, storage } = makeTown();
  await town.fetch(new Request("https://town.internal/state"));
  await town.alarm();

  const restored = new RookwoodTown(new FakeContext(storage), {});
  const state = await (await restored.fetch(new Request("https://town.internal/state"))).json();
  const events = await (await restored.fetch(new Request("https://town.internal/events?limit=1"))).json();

  assert.equal(state.now, "2026-08-31T01:00:00.000Z");
  assert.equal(state.stats.tickCount, 1);
  assert.equal(events.events.length, 1);
  assert.equal(events.eventCount, state.stats.eventCount);
});

test("the Worker delegates default API reads to the town object", async () => {
  const { town } = makeTown();
  const environment = {
    TOWN: { getByName: () => town },
    ASSETS: { fetch: async () => new Response("asset") },
  };
  const state = await (await worker.fetch(new Request("https://town.example/api/town"), environment)).json();
  assert.equal(state.persistence, "durable-object");
  assert.equal(state.residents.length, 15);
});

test("preview parameters preserve the deterministic ephemeral path", async () => {
  const { town } = makeTown();
  const environment = { TOWN: { getByName: () => town }, ASSETS: { fetch: async () => new Response("asset") } };
  const state = await (await worker.fetch(new Request("https://town.example/api/town?ticks=0"), environment)).json();
  assert.equal(state.persistence, "ephemeral");
  assert.equal(state.residents.length, 15);
});
