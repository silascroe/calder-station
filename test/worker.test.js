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
  assert.equal(body.stats.actionCount, 44);
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
  assert.equal(eventsBody.events.length, 81);
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
