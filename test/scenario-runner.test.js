import test from "node:test";
import assert from "node:assert/strict";

import { runScenario } from "../src/scenario-runner.js";

test("the staging runner reports useful 1, 7, 30, and 90 day checkpoints", () => {
  const result = runScenario({
    days: 90,
    checkpoints: [1, 7, 30, 90],
    seed: "long-horizon-regression",
  });

  assert.equal(result.kind, "calder-station-scenario");
  assert.equal(result.days, 90);
  assert.deepEqual(Object.keys(result.checkpoints), ["1", "7", "30", "90"]);

  const first = result.checkpoints["1"];
  const final = result.final;
  assert.equal(first.healthy, true);
  assert.equal(final.healthy, true);
  assert.equal(final.stats.tickCount, 90);
  assert.equal(final.stats.plans, 15 * 90);
  assert.ok(final.stats.actions > final.stats.plans);
  assert.equal(final.decisionsPerResident.sal.plans, 90);
  assert.ok(final.decisionsPerResident.sal.actions > final.decisionsPerResident.sal.plans);
  assert.ok(final.eventCounts["obligation-created"] >= 10);
  assert.ok(final.obligations.created > 1);
  assert.ok(final.obligations.highestGeneration >= 30);
  assert.ok(final.relationshipChanges.changedCount > 0);
  assert.ok(final.ranges.energy.min >= 0 && final.ranges.energy.max <= 100);
  assert.ok(final.ranges.hunger.min >= 0 && final.ranges.hunger.max <= 100);
  assert.deepEqual(final.invariants.stuckResidents, []);
  assert.deepEqual(final.invariants.queueEntriesDueAtEnd, []);
});

test("the same seed and rules produce the same long-horizon report", () => {
  const options = { days: 30, checkpoints: [1, 7, 30], seed: "replay-check" };
  const first = runScenario(options);
  const second = runScenario(options);

  assert.deepEqual(first.final, second.final);
  assert.deepEqual(first.checkpoints, second.checkpoints);
});

test("the runner can execute a short custom horizon without requiring every default checkpoint", () => {
  const result = runScenario({ days: 3 });
  assert.deepEqual(Object.keys(result.checkpoints), ["1"]);
  assert.equal(result.final.stats.tickCount, 3);
  assert.equal(result.final.healthy, true);
});
