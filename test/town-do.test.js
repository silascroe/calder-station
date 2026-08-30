import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";
import { RookwoodTown } from "../src/town-do.js";

class Cursor {
  constructor(rows = []) {
    this.rows = rows;
  }

  toArray() {
    return this.rows;
  }
}

class FakeSql {
  stateRow = null;
  eventRows = new Map();

  exec(query, ...bindings) {
    const normalized = query.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("CREATE INDEX")) {
      return new Cursor();
    }

    if (normalized.startsWith("SELECT state_json FROM town_state")) {
      return new Cursor(this.stateRow ? [this.stateRow] : []);
    }

    if (normalized.startsWith("SELECT event_json FROM town_events")) {
      const rows = [...this.eventRows.values()]
        .sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id))
        .map(({ event_json }) => ({ event_json }));
      return new Cursor(rows);
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
  constructor() {
    this.sql = new FakeSql();
    this.alarmAt = null;
  }

  transactionSync(callback) {
    return callback();
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async setAlarm(at) {
    this.alarmAt = at;
  }
}

class FakeContext {
  constructor(storage) {
    this.storage = storage;
  }

  blockConcurrencyWhile(callback) {
    return callback();
  }
}

function makeTown() {
  const storage = new FakeStorage();
  const town = new RookwoodTown(new FakeContext(storage), {});
  return { town, storage };
}

test("the town object initializes one persistent projection and alarm", async () => {
  const { town, storage } = makeTown();
  const response = await town.fetch(new Request("https://town.internal/state"));
  const state = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.mode, "persistent-scripted-simulation");
  assert.equal(state.persistence, "durable-object");
  assert.equal(state.residents.length, 10);
  assert.equal(state.stats.tickCount, 0);
  assert.equal(state.stats.eventCount, 1);
  assert.equal(storage.sql.eventRows.size, 1);
  assert.ok(storage.alarmAt > Date.now());
});

test("an alarm advances the town and the state survives object reconstruction", async () => {
  const { town, storage } = makeTown();

  await town.fetch(new Request("https://town.internal/state"));
  await town.alarm();

  const restored = new RookwoodTown(new FakeContext(storage), {});
  const stateResponse = await restored.fetch(new Request("https://town.internal/state"));
  const state = await stateResponse.json();
  const eventsResponse = await restored.fetch(new Request("https://town.internal/events"));
  const events = await eventsResponse.json();

  assert.equal(state.now, "2026-08-31T01:00:00.000Z");
  assert.equal(state.stats.tickCount, 1);
  assert.equal(state.persistence, "durable-object");
  assert.equal(events.tickCount, 1);
  assert.equal(events.persistence, "durable-object");
  assert.equal(events.events.length, state.stats.eventCount);
  assert.ok(storage.alarmAt > Date.now());
});

test("the Worker delegates default API reads to the persistent town object", async () => {
  const { town } = makeTown();
  const environment = {
    TOWN: {
      getByName(name) {
        assert.equal(name, "rookwood");
        return town;
      },
    },
    ASSETS: {
      fetch: async () => new Response("asset"),
    },
  };

  const response = await worker.fetch(
    new Request("https://town.example/api/town"),
    environment,
  );
  const state = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.persistence, "durable-object");
  assert.equal(state.mode, "persistent-scripted-simulation");
});

test("preview query parameters keep the old ephemeral inspection path", async () => {
  const { town } = makeTown();
  const environment = {
    TOWN: { getByName: () => town },
    ASSETS: { fetch: async () => new Response("asset") },
  };

  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=0"),
    environment,
  );
  const state = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.persistence, "ephemeral");
  assert.equal(state.mode, "scripted-simulation-preview");
});
