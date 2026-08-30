import { applySocialEncounter } from "./relationship-dynamics.js";

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function relationshipBetween(state, residentId, targetId) {
  return (state.relationships ?? []).find((relationship) => (
    (relationship.fromId === residentId && relationship.toId === targetId)
    || (relationship.fromId === targetId && relationship.toId === residentId)
  ));
}

function hasEncounteredToday(resident, at) {
  return resident.lastEncounterAt && dayKey(resident.lastEncounterAt) === dayKey(at);
}

/**
 * Resolve a social request only when the world makes it possible. A plan can
 * want a conversation, but it cannot teleport the other resident into one.
 */
export function resolveSocialIntentions(state, resident, plan, at) {
  const encounters = [];
  for (const intention of plan.socialIntentions ?? []) {
    if (intention.locationId && intention.locationId !== resident.locationId) continue;
    const target = state.residents.find(({ id }) => id === intention.targetId);
    if (!target || target.locationId !== resident.locationId) continue;
    if (target.lastAction === "rest" || resident.lastAction === "rest") continue;
    if (hasEncounteredToday(resident, at) || hasEncounteredToday(target, at)) continue;

    const relationship = relationshipBetween(state, resident.id, target.id);
    if (!relationship) continue;
    const location = state.locations.find(({ id }) => id === resident.locationId);
    if (!location) continue;

    resident.lastEncounterAt = new Date(at).toISOString();
    resident.lastEncounterWithId = target.id;
    resident.socialCount = (resident.socialCount ?? 0) + 1;
    target.lastEncounterAt = new Date(at).toISOString();
    target.lastEncounterWithId = resident.id;
    target.socialCount = (target.socialCount ?? 0) + 1;
    const change = applySocialEncounter(relationship, at);

    encounters.push({
      actorId: resident.id,
      targetId: target.id,
      locationId: location.id,
      relationshipId: relationship.id,
      relationshipDelta: change.strengthDelta,
      tensionDelta: change.tensionDelta,
      type: "encounter",
      text: change.tone === "tense"
        ? `had a tense conversation with ${target.name} at ${location.name}`
        : change.tone === "repairing"
          ? `cleared the air with ${target.name} at ${location.name}`
          : `talked with ${target.name} at ${location.name}`,
      reason: intention.reason,
    });
  }
  return encounters;
}
