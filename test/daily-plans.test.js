import test from "node:test";
import assert from "node:assert/strict";

import { advanceTown, createInitialTown } from "../src/simulation.js";
import {
  DAILY_PLAN_VERSION,
  scriptedDailyPlan,
  validateDailyPlan,
} from "../src/daily-plans.js";

test("the scripted planner returns a bounded, validated daily plan", () => {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "thom");
  const now = new Date(resident.nextDecisionAt);
  const plan = scriptedDailyPlan({ town, resident, now });

  assert.equal(plan.version, DAILY_PLAN_VERSION);
  assert.equal(plan.residentId, resident.id);
  assert.equal(plan.day, "2026-08-31");
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].locationId, "farm");
  assert.ok(plan.socialIntentions.some(({ targetId }) => targetId === "pella"));
  assert.strictEqual(validateDailyPlan(plan, { town, resident, now }), plan);
});

test("the plan boundary rejects invalid actions and ungrounded social requests", () => {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "thom");
  const now = new Date(resident.nextDecisionAt);
  const plan = scriptedDailyPlan({ town, resident, now });

  assert.throws(() => validateDailyPlan({
    ...plan,
    actions: [{ ...plan.actions[0], locationId: "somewhere-else" }],
  }, { town, resident, now }), /unknown location/);
  assert.throws(() => validateDailyPlan({
    ...plan,
    socialIntentions: [{ type: "talk", targetId: "unknown", locationId: "farm" }],
  }, { town, resident, now }), /unknown resident/);
  assert.throws(() => validateDailyPlan({
    ...plan,
    socialIntentions: [{ type: "talk", targetId: "pella", locationId: "square" }],
  }, { town, resident, now }), /must match the plan action location/);
});

test("a future model planner can use the same boundary without changing the executor", () => {
  const initial = createInitialTown();
  const next = advanceTown(initial, {
    minutes: 1440,
    decisionAdapter: ({ town, resident, now }) => ({
      ...scriptedDailyPlan({ town, resident, now }),
      source: "model",
    }),
  });

  assert.equal(next.stats.planCount, 15);
  assert.equal(next.stats.modelCalls, 15);
  assert.ok(next.events.some((event) => event.source === "model" && event.actorId === "pella"));
});
