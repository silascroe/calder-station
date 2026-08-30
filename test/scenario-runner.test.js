import test from "node:test";
import assert from "node:assert/strict";

import { runScenario } from "../src/scenario-runner.js";
import { scriptedObligationPlan } from "../src/obligations.js";

test("the staging runner reports useful 1, 7, 30, and 90 day checkpoints", async () => {
  const result = await runScenario({
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
  assert.equal(final.longHorizon.relationshipDynamics.total, 27);
  assert.ok(final.longHorizon.relationshipDynamics.saturated.length > 0);
  assert.ok(final.longHorizon.eventDiversity.topTenShare > 0);
  assert.equal(Object.keys(final.longHorizon.dailyPatterns).length, 15);
  assert.equal(Object.keys(final.longHorizon.personalHistories).length, 15);
  assert.equal(Object.keys(final.longHorizon.placeParticipation).length, 14);
  assert.ok(final.longHorizon.dailyPatterns.mara.dominantShare > 0);
});

test("the same seed and rules produce the same long-horizon report", async () => {
  const options = { days: 30, checkpoints: [1, 7, 30], seed: "replay-check" };
  const first = await runScenario(options);
  const second = await runScenario(options);

  assert.deepEqual(first.final, second.final);
  assert.deepEqual(first.checkpoints, second.checkpoints);
});

test("the runner can execute a short custom horizon without requiring every default checkpoint", async () => {
  const result = await runScenario({ days: 3 });
  assert.deepEqual(Object.keys(result.checkpoints), ["1"]);
  assert.equal(result.final.stats.tickCount, 3);
  assert.equal(result.final.healthy, true);
});

test("the runner awaits an asynchronous planner through the authoritative engine", async () => {
  let calls = 0;
  const result = await runScenario({
    days: 1,
    decisionAdapter: async (input) => {
      calls += 1;
      await Promise.resolve();
      return scriptedObligationPlan(input);
    },
  });

  assert.equal(calls, 15);
  assert.equal(result.final.stats.plans, 15);
  assert.equal(result.final.healthy, true);
});
