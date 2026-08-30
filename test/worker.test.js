import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";

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
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.engine, "deterministic-scripted");
  assert.equal(body.persistence, "ephemeral");
  assert.equal(body.modelCalls, 0);
});

test("town endpoint exposes a replayable three-resident simulation", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "Rookwood");
  assert.equal(body.residents.length, 3);
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.stats.tickCount, 22);
  assert.equal(body.stats.decisionCount, 3);
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
  assert.equal(eventsBody.events.length, 7);
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
