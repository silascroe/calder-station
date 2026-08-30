import test from "node:test";
import assert from "node:assert/strict";

import { isPeakPeriod } from "../src/scheduler.js";
import {
  DEFAULT_START_TIME,
  advanceTown,
  createInitialTown,
  eventView,
  runPreview,
  townView,
} from "../src/simulation.js";

test("the seed creates three residents with staggered routine decisions", () => {
  const town = createInitialTown();
  const decisionTimes = town.residents.map((resident) => resident.nextDecisionAt);

  assert.equal(town.now, DEFAULT_START_TIME);
  assert.equal(town.mode, "scripted-simulation-preview");
  assert.equal(town.residents.length, 3);
  assert.equal(new Set(decisionTimes).size, 3);
  assert.ok(decisionTimes.every((time) => !isPeakPeriod(time)));
  assert.equal(town.events.length, 1);
  assert.equal(town.events[0].type, "system");
});

test("a preview advances the clock and lets each resident make a decision", () => {
  const town = runPreview({ ticks: 22 });
  const decisions = town.events.filter((event) => event.type === "decision");
  const movements = town.events.filter((event) => event.type === "movement");

  assert.equal(town.now, "2026-08-31T22:00:00.000Z");
  assert.equal(town.day, 1);
  assert.equal(town.stats.tickCount, 22);
  assert.equal(town.stats.decisionCount, 3);
  assert.equal(decisions.length, 3);
  assert.equal(new Set(decisions.map((event) => event.actorId)).size, 3);
  assert.equal(movements.length, 3);
  assert.ok(town.residents.every((resident) => resident.energy >= 0 && resident.energy <= 100));
  assert.ok(town.residents.every((resident) => resident.hunger >= 0 && resident.hunger <= 100));
});

test("the same seed produces the same state and event history", () => {
  const first = runPreview({ ticks: 22, seed: "test-seed" });
  const second = runPreview({ ticks: 22, seed: "test-seed" });

  assert.deepEqual(first, second);
});

test("advancing a town does not mutate the previous snapshot", () => {
  const initial = createInitialTown();
  const next = advanceTown(initial);

  assert.equal(initial.now, DEFAULT_START_TIME);
  assert.equal(initial.stats.tickCount, 0);
  assert.notEqual(next.now, initial.now);
  assert.notEqual(next.residents, initial.residents);
});

test("views keep town state and newest-first events separate", () => {
  const state = runPreview({ ticks: 22 });
  const town = townView(state);
  const events = eventView(state);

  assert.equal("events" in town, false);
  assert.equal(events[0].at >= events.at(-1).at, true);
  assert.equal(events.length, state.events.length);
});
