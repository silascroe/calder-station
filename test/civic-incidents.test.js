import test from "node:test";
import assert from "node:assert/strict";

import {
  createDueCivicObligations,
  normalizeCivicIncidents,
  recordCivicOutcome,
} from "../src/civic-incidents.js";
import {
  applyCommitmentOutcome,
  applySocialEncounter,
  normalizeRelationship,
} from "../src/relationship-dynamics.js";
import { createInitialTown } from "../src/simulation.js";

test("authored civic chains create unique commitments with explicit lineage", () => {
  const town = createInitialTown();
  normalizeCivicIncidents(town);
  const at = new Date(new Date(town.startedAt).getTime() + 6 * 24 * 60 * 60 * 1000);
  const roots = createDueCivicObligations(town, at);
  assert.equal(roots.length, 4);
  assert.equal(new Set(roots.map(({ id }) => id)).size, roots.length);

  const clinic = roots.find(({ civicChainId }) => civicChainId === "care-and-records");
  clinic.status = "fulfilled";
  clinic.resolvedAt = at.toISOString();
  assert.equal(recordCivicOutcome(town, clinic, at), true);

  const followUps = createDueCivicObligations(town, new Date(at.getTime() + 24 * 60 * 60 * 1000));
  const school = followUps.find(({ civicChainId }) => civicChainId === "care-and-records");
  assert.equal(school.civicStep, 1);
  assert.equal(school.parentObligationId, clinic.id);
  assert.notEqual(school.id, clinic.id);
});

test("relationship tension makes commitments and conversations non-monotonic", () => {
  const relationship = normalizeRelationship({
    id: "test",
    fromId: "a",
    toId: "b",
    kind: "old debt",
    strength: 60,
  });
  const delayed = applyCommitmentOutcome(relationship, "delayed", "2026-09-01T00:00:00.000Z");
  assert.equal(delayed.strengthDelta, -3);
  assert.ok(relationship.tension >= 20);

  const tense = applySocialEncounter(relationship, "2026-09-02T00:00:00.000Z");
  assert.equal(tense.tone, "tense");
  assert.equal(tense.strengthDelta, -1);
  const repairing = applySocialEncounter(relationship, "2026-09-03T00:00:00.000Z");
  assert.equal(repairing.tone, "repairing");
  assert.equal(repairing.strengthDelta, 0);
  assert.ok(relationship.tension < 20);
});
