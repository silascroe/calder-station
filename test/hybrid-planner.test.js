import test from "node:test";
import assert from "node:assert/strict";

import { modelConflictEligible, planResidentDecision } from "../src/hybrid-planner.js";
import { materializeObligation } from "../src/obligations.js";
import { createInitialTown } from "../src/simulation.js";

function conflictFixture() {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextPlanAt);
  town.obligations.push(materializeObligation({
    id: "test-route-conflict",
    kind: "civic-request",
    ownerId: "sal",
    counterpartyId: "amos",
    destinationId: "square",
    requiredAction: "observe",
    title: "Amos Foster's route report",
    description: "The closing round depends on this report.",
    dueAt: new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString(),
  }, now));
  return { town, resident, now };
}

test("model calls are reserved for two actionable commitments before the next turn", async () => {
  const single = createInitialTown();
  const singleResident = single.residents.find(({ id }) => id === "sal");
  const singleNow = new Date(singleResident.nextPlanAt);
  assert.equal(modelConflictEligible(single, singleResident, singleNow), false);

  let calls = 0;
  const singlePlan = await planResidentDecision({ town: single, resident: singleResident, now: singleNow }, {
    env: { DEEPSEEK_API_KEY: "test-key" },
    fetchImpl: async () => { calls += 1; throw new Error("must not call"); },
    bypassPeakPricing: true,
  });
  assert.equal(calls, 0);
  assert.equal(singlePlan.source, "scripted");

  const conflict = conflictFixture();
  assert.equal(modelConflictEligible(conflict.town, conflict.resident, conflict.now), true);
  conflict.resident.hunger = 94;
  assert.equal(modelConflictEligible(conflict.town, conflict.resident, conflict.now), false);
});
