import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";
import { createInitialTown } from "../src/simulation.js";
import { materializeObligation } from "../src/obligations.js";
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
    if (normalized.startsWith("SELECT id FROM town_events ORDER BY rowid DESC")) {
      const rows = [...this.eventRows.values()];
      return new Cursor(rows.length > 0 ? [{ id: rows.at(-1).id }] : []);
    }
    if (normalized.startsWith("SELECT event_json FROM town_events")) {
      const limit = bindings[0] ?? Number.POSITIVE_INFINITY;
      const rows = [...this.eventRows.values()];
      if (normalized.includes("ORDER BY rowid DESC")) rows.reverse();
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
  constructor() { this.sql = new FakeSql(); this.alarmAt = null; this.values = new Map(); }
  transactionSync(callback) { return callback(); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at) { this.alarmAt = at; }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
}

class FakeContext {
  constructor(storage) { this.storage = storage; }
  blockConcurrencyWhile(callback) { return callback(); }
}

function makeTown(env = {}) {
  const storage = new FakeStorage();
  return { town: new RookwoodTown(new FakeContext(storage), env), storage };
}

function addSalConflict(state, at) {
  const now = new Date(at);
  state.obligations.find(({ id }) => id === "obligation-sal-vey-notice").dueAt = new Date(
    now.getTime() + 60 * 60 * 1000,
  ).toISOString();
  state.obligations.push(materializeObligation({
    id: "test-sal-route-report",
    kind: "civic-request",
    ownerId: "sal",
    counterpartyId: "amos",
    destinationId: "square",
    requiredAction: "observe",
    title: "Amos Foster's route report",
    description: "The square needs checking before the closing round.",
    dueAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    renewable: false,
  }, now));
  return state;
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

test("current-revision evolved state persists runtime metadata backfills", async () => {
  const { town, storage } = makeTown();
  const evolved = createInitialTown();
  evolved.residents[0].energy = 37;
  delete evolved.civicIncidents;
  delete evolved.stats.civicObligationCreatedCount;
  delete evolved.stats.conflictedPlanCount;
  for (const relationship of evolved.relationships) {
    delete relationship.baselineStrength;
    delete relationship.tension;
    delete relationship.interactionCount;
    delete relationship.lastInteractionAt;
  }
  for (const obligation of evolved.obligations) delete obligation.requiredAction;
  town.persist(evolved);

  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();
  const persisted = JSON.parse(storage.sql.stateRow.state_json);
  assert.equal(state.residents[0].energy, 37);
  assert.ok(state.civicIncidents.chains["care-and-records"]);
  assert.equal(state.relationships[0].baselineStrength, state.relationships[0].strength);
  assert.equal(state.obligations[0].requiredAction, "deliver");
  assert.ok(persisted.civicIncidents.chains["night-route"]);
  assert.equal(persisted.relationships[0].interactionCount, 0);
  assert.equal(persisted.stats.conflictedPlanCount, 0);
});

test("event history preserves insertion order past four-digit IDs and repairs a stale sequence", async () => {
  const { town, storage } = makeTown();
  const evolved = createInitialTown();
  const at = "2026-09-01T00:00:00.000Z";
  evolved.events = Array.from({ length: 10_000 }, (_, index) => ({
    id: `event-${String(index + 1).padStart(4, "0")}`,
    at,
    time: "Day 2, 00:00",
    actorId: null,
    actor: "Town",
    type: "system",
    text: `history entry ${index + 1}`,
    source: "test",
  }));
  delete evolved.stats.eventCount;
  town.persist(evolved);

  const newest = town.readEvents(2);
  assert.deepEqual(newest.map(({ id }) => id), ["event-10000", "event-9999"]);

  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();
  const persisted = JSON.parse(storage.sql.stateRow.state_json);
  assert.equal(state.stats.eventCount, 10_001);
  assert.equal(persisted.stats.eventCount, 10_001);
  assert.ok(storage.sql.eventRows.has("event-10001"));
});

test("a due Sal decision uses one model plan and records its usage", async () => {
  let calls = 0;
  let requestContext;
  const { town, storage } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const prompt = body.messages.at(-1).content;
      requestContext = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      return new Response(JSON.stringify({
        id: "chatcmpl-town-test",
        model: "deepseek-v4-flash",
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              obligationId: "obligation-sal-vey-notice",
              choice: "fulfill",
              note: "The direct route is still possible.",
            }),
          },
        }],
        usage: { prompt_tokens: 400, completion_tokens: 80, total_tokens: 480 },
      }), { status: 200 });
    },
  });
  const initial = createInitialTown();
  initial.residents.find(({ id }) => id === "sal").nextDecisionAt = "2026-08-31T00:30:00.000Z";
  addSalConflict(initial, "2026-08-31T00:30:00.000Z");
  town.persist(initial);

  await town.alarm({ wallClock: new Date("2026-08-31T00:00:00.000Z") });
  await town.alarm({ wallClock: new Date("2026-08-31T01:00:00.000Z") });
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();

  assert.equal(calls, 1);
  assert.equal(state.stats.modelCalls, 1);
  assert.equal(state.stats.modelAttempts, 1);
  assert.equal(state.stats.modelFallbacks, 0);
  assert.equal(state.stats.modelPromptTokens, 400);
  assert.equal(state.stats.modelCompletionTokens, 80);
  assert.equal(state.obligations[0].status, "fulfilled");
  assert.equal(state.residents.find(({ id }) => id === "sal").dailyPlan.source, "model");
  assert.ok(state.residents.find(({ id }) => id === "sal").dailyPlan.actions.length > 1);
  assert.equal(requestContext.town.now, "2026-08-31T00:30:00.000Z");
  assert.equal(requestContext.resident.energy, 86);
  assert.equal(requestContext.resident.hunger, 23);
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
  addSalConflict(initial, "2026-08-31T00:30:00.000Z");
  town.persist(initial);

  await town.alarm({ wallClock: new Date("2026-08-31T00:00:00.000Z") });
  await town.alarm({ wallClock: new Date("2026-08-31T01:00:00.000Z") });
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
  const resident = initial.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextPlanAt);
  addSalConflict(initial, now);

  const result = await town.decisionPlanFor(
    { town: initial, resident, now },
    { wallClock: new Date("2026-09-01T02:00:00.000Z") },
  );

  assert.equal(result.source, "scripted");
  assert.equal(result.modelTelemetry.skipped, true);
  assert.equal(result.modelTelemetry.policyReason, "peak-pricing-window");
  assert.equal(calls, 0);
});

test("deliberate evaluation can bypass peak pricing without changing simulated time", async () => {
  let calls = 0;
  const { town } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      calls += 1;
      throw new Error("provider unavailable");
    },
  });
  const initial = createInitialTown();
  const resident = initial.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextPlanAt);
  addSalConflict(initial, now);
  const result = await town.decisionPlanFor(
    { town: initial, resident, now },
    { wallClock: new Date("2026-09-01T02:00:00.000Z"), bypassPeakPricing: true },
  );

  assert.equal(calls, 1);
  assert.equal(result.modelTelemetry.attempted, true);
  assert.equal(result.modelTelemetry.fallback, true);
});

test("an interrupted model request falls back on retry instead of spending twice", async () => {
  let calls = 0;
  const { town, storage } = makeTown({
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      calls += 1;
      throw new Error("must not repeat an outcome-unknown request");
    },
  });
  const initial = createInitialTown();
  const resident = initial.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextPlanAt);
  addSalConflict(initial, now);
  await storage.put(`model-decision:sal:${now.toISOString()}`, {
    status: "pending",
    residentId: "sal",
    simulatedAt: now.toISOString(),
  });

  const result = await town.decisionPlanFor(
    { town: initial, resident, now },
    { wallClock: new Date("2026-09-01T00:00:00.000Z") },
  );

  assert.equal(calls, 0);
  assert.equal(result.source, "scripted");
  assert.equal(result.modelTelemetry.fallback, true);
  assert.equal(result.modelTelemetry.errorCode, "interrupted-request-guard");
});

test("staging uses a separate durable-object storage key and mode", async () => {
  const { town, storage } = makeTown({ TOWN_ENV: "staging" });
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();

  assert.equal(state.environment, "staging");
  assert.equal(state.mode, "staging-persistent-simulation");
  assert.equal(storage.sql.stateRow.id, "rookwood-staging");
});

test("staging persists a bounded model evaluation report outside the town projection", async () => {
  const { town, storage } = makeTown({
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
  });
  const report = {
    kind: "calder-station-model-evaluation",
    revision: "evaluation-test",
    status: "complete",
    calls: 8,
  };
  const stored = await town.fetch(new Request("https://town.internal/evaluation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  }));
  const read = await town.fetch(new Request("https://town.internal/evaluation"));

  assert.equal(stored.status, 200);
  assert.deepEqual(await read.json(), report);
  assert.deepEqual(storage.values.get("model-evaluation:evaluation-test"), report);
  assert.equal(storage.sql.stateRow, null);
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

test("an alarm retry after persistence does not advance a second hour", async () => {
  const { town } = makeTown();
  await town.fetch(new Request("https://town.internal/state"));
  const first = await town.alarm({ wallClock: new Date("2026-08-31T01:00:00.000Z") });
  const retry = await town.alarm({
    wallClock: new Date("2026-08-31T01:00:01.000Z"),
    isRetry: true,
    retryCount: 1,
  });
  const state = await (await town.fetch(new Request("https://town.internal/state"))).json();
  const health = await (await town.fetch(new Request("https://town.internal/health"))).json();

  assert.equal(first.status, "advanced");
  assert.equal(retry.status, "already-advanced");
  assert.equal(state.now, "2026-08-31T01:00:00.000Z");
  assert.equal(state.stats.tickCount, 1);
  assert.equal(health.clockPolicy, "pause-on-downtime");
  assert.equal(health.simulationStepMinutes, 60);
});

test("a failing alarm records the fault and schedules a later recovery attempt", async () => {
  const { town, storage } = makeTown();
  const initial = createInitialTown();
  const sal = initial.residents.find(({ id }) => id === "sal");
  sal.nextPlanAt = "2026-08-31T00:30:00.000Z";
  sal.nextDecisionAt = sal.nextPlanAt;
  town.persist(initial);
  storage.alarmAt = null;
  town.decisionPlanFor = async () => {
    throw new Error("simulated handler crash");
  };

  const result = await town.alarm({ wallClock: new Date("2026-08-31T00:00:00.000Z") });
  const health = await (await town.fetch(new Request("https://town.internal/health"))).json();

  assert.equal(result.status, "failed");
  assert.equal(result.error, "Error");
  assert.equal(storage.alarmAt, Date.parse("2026-08-31T01:00:00.000Z"));
  assert.equal(JSON.parse(storage.sql.stateRow.state_json).now, initial.now);
  assert.equal(health.lastAlarmStatus, "failed");
  assert.equal(health.lastAlarmError, "Error");
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
