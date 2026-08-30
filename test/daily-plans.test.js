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
  assert.ok(plan.actions.length >= 2);
  assert.equal(plan.actions[0].locationId, "farm");
  assert.equal(plan.actions[0].offsetMinutes, 0);
  assert.ok(plan.actions.every((action, index) => index === 0 || action.offsetMinutes > plan.actions[index - 1].offsetMinutes));
  assert.ok(plan.actions.some((action) => action.action === "rest" && action.locationId === resident.homeLocationId));
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

test("the plan boundary validates effective queue offsets, including omitted offsets", () => {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "thom");
  const now = new Date(resident.nextDecisionAt);
  const plan = scriptedDailyPlan({ town, resident, now });

  assert.throws(() => validateDailyPlan({
    ...plan,
    actions: plan.actions.map((action, index) => ({
      ...action,
      offsetMinutes: index === 0 ? 60 : action.offsetMinutes,
    })),
  }, { town, resident, now }), /first daily plan action/);

  assert.throws(() => validateDailyPlan({
    ...plan,
    actions: [
      { ...plan.actions[0], offsetMinutes: 0 },
      { ...plan.actions[0], offsetMinutes: 240 },
      { ...plan.actions[0], offsetMinutes: undefined },
      { ...plan.actions[0], offsetMinutes: undefined },
    ],
  }, { town, resident, now }), /non-decreasing/);
});

test("a future model planner can use the same boundary without changing the executor", async () => {
  const initial = createInitialTown();
  const next = await advanceTown(initial, {
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
