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

function makeTown() {
  const storage = new FakeStorage();
  return { town: new RookwoodTown(new FakeContext(storage), {}), storage };
}

test("the town object initializes the current persistent Rookwood", async () => {
  const { town, storage } = makeTown();
  const response = await town.fetch(new Request("https://town.internal/state"));
  const state = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.persistence, "durable-object");
  assert.equal(state.residents.length, 15);
  assert.equal(state.locations.length, 14);
  assert.equal(state.relationships.length, 27);
  assert.equal(state.stats.eventCount, 1);
  assert.equal(storage.sql.eventRows.size, 1);
  assert.ok(storage.alarmAt > Date.now());
});

test("an existing ten-person projection reconciles without replacing evolved state", async () => {
  const { town, storage } = makeTown();
  const old = createInitialTown();
  old.residents = old.residents.slice(0, 10);
  old.locations = old.locations.slice(0, 11);
  old.relationships = old.relationships.slice(0, 12);
  old.seedRevision = 1;
  old.residents[0].energy = 41;
  town.persist(old);

  const response = await town.fetch(new Request("https://town.internal/state"));
  const state = await response.json();

  assert.equal(state.residents.length, 15);
  assert.equal(state.locations.length, 14);
  assert.equal(state.relationships.length, 27);
  assert.equal(state.residents.find(({ id }) => id === "mara").energy, 41);
  assert.ok(state.residents.some(({ id }) => id === "edda"));
  assert.equal(state.stats.eventCount, 2);
  assert.equal(storage.sql.eventRows.size, 2);
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
