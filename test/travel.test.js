import test from "node:test";
import assert from "node:assert/strict";

import { materializeObligation, scriptedObligationPlan } from "../src/obligations.js";
import { createInitialTown } from "../src/simulation.js";
import {
  bestObligationOrder,
  projectObligationOrder,
  schedulePlanActions,
  travelMinutesBetween,
} from "../src/travel.js";

function physicalConflict() {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextPlanAt);
  resident.locationId = "square";
  town.obligations[0].dueAt = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
  town.obligations.push(materializeObligation({
    id: "travel-test-route",
    kind: "civic-request",
    ownerId: "sal",
    counterpartyId: "amos",
    destinationId: "square",
    requiredAction: "observe",
    title: "Amos Foster's route report",
    description: "The closing round depends on this report.",
    dueAt: new Date(now.getTime() + 25 * 60 * 1000).toISOString(),
  }, now));
  return { town, resident, now, obligations: town.obligations };
}

test("map distance and service time shift the authoritative action queue", () => {
  const { town, resident, now } = physicalConflict();
  assert.equal(travelMinutesBetween(town, "square", "town-hall"), 11);
  const timings = schedulePlanActions(town, resident, [
    { action: "observe", locationId: "square", offsetMinutes: 0 },
    { action: "deliver", locationId: "town-hall", offsetMinutes: 1 },
  ], now);
  assert.equal(timings[0].scheduledAt, now.toISOString());
  assert.equal(timings[0].serviceMinutes, 30);
  assert.equal(timings[1].travelMinutes, 11);
  assert.equal(new Date(timings[1].scheduledAt) - now, 41 * 60 * 1000);
});

test("the feasibility solver distinguishes a true conflict and queues the losing attempt", () => {
  const { town, resident, now, obligations } = physicalConflict();
  assert.ok(obligations.every((obligation) => (
    projectObligationOrder(town, resident, [obligation], now).allMeet
  )));
  const best = bestObligationOrder(town, resident, obligations, now);
  assert.equal(best.projection.allMeet, false);
  assert.equal(best.projection.metCount, 1);

  const plan = scriptedObligationPlan({ town, resident, now });
  assert.equal(plan.obligationDecisions.length, 2);
  assert.deepEqual(new Set(plan.obligationDecisions.map(({ obligationId }) => obligationId)), new Set(obligations.map(({ id }) => id)));
});
