import test from "node:test";
import assert from "node:assert/strict";

import worker, { runScheduledModelEvaluation } from "../src/worker.js";

function assets() {
  return {
    fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`),
  };
}

test("health endpoint reports the deterministic simulation Worker", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/health"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "town-dashboard");
  assert.equal(body.environment, "preview");
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.engine, "deterministic-scripted");
  assert.equal(body.persistence, "ephemeral");
  assert.equal(body.modelCalls, 0);
});

test("town endpoint exposes the replayable fifteen-resident simulation", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "Calder Station");
  assert.equal(body.residents.length, 15);
  assert.equal(body.locations.length, 14);
  assert.equal(body.relationships.length, 27);
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.stats.tickCount, 24);
  assert.equal(body.stats.decisionCount, 15);
  assert.ok(body.stats.actionCount > body.stats.planCount);
  assert.equal("events" in body, false);
});

test("events endpoint returns newest events and page routes delegate to assets", async () => {
  const environment = { ASSETS: assets() };
  const eventsResponse = await worker.fetch(new Request("https://town.example/api/events"), environment);
  const missing = await worker.fetch(new Request("https://town.example/api/nope"), environment);
  const page = await worker.fetch(new Request("https://town.example/map"), environment);
  const eventsBody = await eventsResponse.json();

  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsBody.events[0].type, "decision");
  assert.ok(eventsBody.events.length > 80);
  assert.equal(eventsBody.events.at(-1).type, "system");
  assert.equal(missing.status, 404);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "asset:/map");
});

test("the read-only API rejects mutations", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town", { method: "POST" }),
    { ASSETS: assets() },
  );

  assert.equal(response.status, 405);
});

test("preview ticks can be changed without making the API mutable", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=0"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.now, "2026-08-31T00:00:00.000Z");
  assert.equal(body.name, "Calder Station");
  assert.equal(body.stats.tickCount, 0);
  assert.equal(body.stats.decisionCount, 0);
});

test("invalid preview ticks return a client error", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=999"),
    { ASSETS: assets() },
  );

  assert.equal(response.status, 400);
});

test("event limits are validated and applied", async () => {
  const environment = { ASSETS: assets() };
  const limited = await worker.fetch(new Request("https://town.example/api/events?limit=3"), environment);
  const invalid = await worker.fetch(new Request("https://town.example/api/events?limit=0"), environment);

  assert.equal((await limited.json()).events.length, 3);
  assert.equal(invalid.status, 400);
});

test("staging exposes a read-only evaluation report without a public trigger", async () => {
  const report = { revision: "evaluation-test", status: "complete", calls: 24 };
  const stub = { fetch: async () => new Response(JSON.stringify(report)) };
  const env = {
    TOWN_ENV: "staging",
    TOWN: { getByName: () => stub },
    ASSETS: assets(),
  };
  const response = await worker.fetch(new Request("https://town.example/api/evaluation"), env);
  const mutation = await worker.fetch(new Request("https://town.example/api/evaluation", { method: "POST" }), env);

  assert.deepEqual(await response.json(), report);
  assert.equal(mutation.status, 405);
});

test("the scheduled evaluator never automatically repeats a terminal or in-flight revision", async () => {
  for (const status of ["complete", "failed", "running"]) {
    let reads = 0;
    const report = { revision: "evaluation-test", status, calls: 24 };
    const env = {
      TOWN_ENV: "staging",
      MODEL_EVALUATION_REVISION: "evaluation-test",
      DEEPSEEK_API_KEY: "test-key",
      TOWN: {
        getByName: () => ({
          fetch: async () => {
            reads += 1;
            return new Response(JSON.stringify(report));
          },
        }),
      },
    };

    assert.deepEqual(await runScheduledModelEvaluation(env), report);
    assert.equal(reads, 1);
  }
  assert.deepEqual(await runScheduledModelEvaluation({ TOWN_ENV: "production" }), { status: "skipped-non-staging" });
});

test("the scheduled evaluator stores a running lease before provider calls", async () => {
  const writes = [];
  let providerCalls = 0;
  const stub = {
    fetch: async (request) => {
      if (request.method === "POST") {
        writes.push(await request.json());
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ revision: "evaluation-test", status: "pending" }));
    },
  };
  const report = await runScheduledModelEvaluation({
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
    DEEPSEEK_API_KEY: "test-key",
    DEEPSEEK_FETCH: async () => {
      providerCalls += 1;
      throw new Error("provider unavailable");
    },
    TOWN: { getByName: () => stub },
  }, { wallClock: new Date("2026-08-31T00:00:00.000Z") });

  assert.equal(providerCalls, 24);
  assert.equal(writes[0].status, "running");
  assert.equal(writes.at(-1).status, "complete");
  assert.equal(report.fallbackCount, 24);
});
