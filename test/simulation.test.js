import test from "node:test";
import assert from "node:assert/strict";

import { tinyTownSeed } from "../src/demo-data.js";
import {
  DEFAULT_START_TIME,
  advanceTown,
  createInitialTown,
  eventView,
  runPreview,
  townView,
} from "../src/simulation.js";

test("the town seed creates fifteen integrated residents, places, and relationships", () => {
  const town = createInitialTown();
  const decisionTimes = town.residents.map((resident) => resident.nextDecisionAt);

  assert.equal(town.now, DEFAULT_START_TIME);
  assert.equal(town.name, "Calder Station");
  assert.equal(town.mode, "scripted-simulation-preview");
  assert.equal(town.residents.length, 15);
  assert.equal(town.locations.length, 14);
  assert.equal(town.relationships.length, 27);
  assert.equal(town.obligations.length, 1);
  assert.equal(town.obligations[0].ownerId, "sal");
  assert.equal(town.obligations[0].counterpartyId, "vey");
  assert.equal(town.obligations[0].status, "open");
  const residentIds = new Set(town.residents.map((resident) => resident.id));
  assert.ok(town.relationships.every((relationship) => (
    relationship.fromId !== relationship.toId
    && residentIds.has(relationship.fromId)
    && residentIds.has(relationship.toId)
    && relationship.strength >= 0
    && relationship.strength <= 100
  )));
  assert.equal(new Set(decisionTimes).size, 15);
  assert.ok(Math.max(...decisionTimes.map(Date.parse)) - Math.min(...decisionTimes.map(Date.parse)) > 20 * 60 * 60 * 1000);
  assert.equal(town.events.length, 1);
  assert.equal(town.events[0].type, "system");

  const locationIds = new Set(town.locations.map(({ id }) => id));
  for (const resident of town.residents) {
    assert.ok(locationIds.has(resident.homeLocationId));
    assert.ok(locationIds.has(resident.workLocationId));
  }
  for (const id of ["edda", "vey", "tamsin", "amos", "lio"]) {
    const ties = town.relationships.filter(({ fromId, toId }) => fromId === id || toId === id);
    assert.ok(ties.length >= 3, `${id} should enter town with at least three ties`);
  }
});

test("a preview advances the clock and lets each resident make a decision", async () => {
  const town = await runPreview();
  const decisions = town.events.filter((event) => event.type === "decision");
  const movements = town.events.filter((event) => event.type === "movement");

  assert.equal(town.now, "2026-09-01T00:00:00.000Z");
  assert.equal(town.day, 2);
  assert.equal(town.stats.tickCount, 24);
  assert.equal(town.stats.decisionCount, 15);
  assert.equal(decisions.length, town.stats.actionCount);
  assert.equal(new Set(decisions.map((event) => event.actorId)).size, 15);
  assert.ok(movements.length >= 10);
  assert.ok(town.residents.every((resident) => resident.energy >= 0 && resident.energy <= 100));
  assert.ok(town.residents.every((resident) => resident.hunger >= 0 && resident.hunger <= 100));
  assert.ok(decisions.some((event) => event.actorId === "edda"));
  assert.ok(decisions.some((event) => event.actorId === "amos"));
  assert.equal(town.stats.planCount, 15);
  assert.ok(town.stats.encounterCount >= 3);
  assert.equal(town.stats.modelCalls, 0);
  assert.equal(town.stats.modelAttempts, 0);
  assert.ok(town.residents.every((resident) => resident.dailyPlan?.action));
  assert.ok(town.residents.every((resident) => resident.actionCount >= resident.planCount));
  assert.ok(town.events.some((event) => event.type === "obligation-created"));
  assert.ok(town.events.some((event) => event.type === "encounter" && event.relatedActorId));
  assert.equal(town.obligations[0].status, "fulfilled");
  assert.equal(town.obligations[0].resolution, "fulfill");
  assert.ok(town.relationships.find(({ id }) => id === "rel-vey-sal").strength > 59);
  assert.ok(town.events.some((event) => event.type === "obligation" && event.actorId === "sal"));
  assert.ok(town.relationships.find(({ id }) => id === "rel-thom-pella").strength > 74);
  assert.equal(town.residents.find(({ id }) => id === "thom").lastEncounterWithId, "pella");
  assert.equal(town.residents.find(({ id }) => id === "pella").lastEncounterWithId, "thom");
});

test("the second day exercises ordinary meal and rest rules", async () => {
  const town = await runPreview({ ticks: 48 });
  const decisions = town.events.filter((event) => event.type === "decision");

  assert.equal(town.stats.decisionCount, 30);
  assert.ok(town.stats.actionCount > town.stats.planCount * 2);
  assert.ok(decisions.some((event) => event.text.startsWith("stopped to eat")));
  assert.ok(decisions.some((event) => event.action === "rest"));
  assert.equal(town.stats.planCount, 30);
  assert.ok(town.stats.encounterCount >= 3);
});

test("the tiny seed remains available as a compact regression scenario", async () => {
  const town = await runPreview({ ticks: 22, seedData: tinyTownSeed });

  assert.equal(town.residents.length, 3);
  assert.equal(town.locations.length, 4);
  assert.equal(town.relationships.length, 1);
  assert.equal(town.stats.decisionCount, 3);
  assert.ok(town.stats.actionCount > town.stats.planCount);
});

test("the same seed produces the same state and event history", async () => {
  const first = await runPreview({ ticks: 22, seed: "test-seed" });
  const second = await runPreview({ ticks: 22, seed: "test-seed" });

  assert.deepEqual(first, second);
});

test("advancing a town does not mutate the previous snapshot", async () => {
  const initial = createInitialTown();
  const next = await advanceTown(initial);

  assert.equal(initial.now, DEFAULT_START_TIME);
  assert.equal(initial.stats.tickCount, 0);
  assert.notEqual(next.now, initial.now);
  assert.notEqual(next.residents, initial.residents);
});

test("views keep town state and newest-first events separate", async () => {
  const state = await runPreview();
  const town = townView(state);
  const events = eventView(state);

  assert.equal("events" in town, false);
  assert.equal(town.relationships.length, 27);
  assert.equal(events[0].at >= events.at(-1).at, true);
  assert.equal(events.length, state.events.length);
});
