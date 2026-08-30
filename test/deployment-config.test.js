import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { validateDeployConfig } from "../scripts/validate-deploy-config.mjs";
import worker from "../src/worker.js";

const config = JSON.parse(fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("production and staging declare isolated persistent bindings", () => {
  const result = validateDeployConfig(config);
  assert.equal(result.productionWorker, "town-dashboard");
  assert.equal(result.stagingWorker, "town-dashboard-staging");
  assert.equal(result.durableObjectClass, "RookwoodTown");
});

test("a configured environment cannot masquerade as an ephemeral town without TOWN", async () => {
  for (const environment of ["production", "staging"]) {
    const response = await worker.fetch(
      new Request("https://town.example/api/health"),
      { TOWN_ENV: environment, ASSETS: { fetch: async () => new Response("asset") } },
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.environment, environment);
    assert.equal(body.persistence, "misconfigured");
    assert.equal(body.expectedBinding, "TOWN");
  }
});

test("explicit local previews remain available without persistent configuration", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=0"),
    { TOWN_ENV: "staging", ASSETS: { fetch: async () => new Response("asset") } },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).persistence, "ephemeral");
});
