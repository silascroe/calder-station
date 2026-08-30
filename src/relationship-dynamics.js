function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function initialTension(kind = "") {
  const normalized = kind.toLowerCase();
  if (normalized.includes("dispute")) return 24;
  if (normalized.includes("rival")) return 20;
  if (normalized.includes("debt")) return 14;
  return 0;
}

export function normalizeRelationship(relationship) {
  relationship.baselineStrength ??= relationship.strength;
  relationship.tension ??= initialTension(relationship.kind);
  relationship.interactionCount ??= 0;
  relationship.lastInteractionAt ??= null;
  return relationship;
}

function strengthGain(strength, ordinary = 1) {
  if (strength >= 90) return 0;
  if (strength >= 75) return Math.min(1, ordinary);
  return ordinary;
}

function apply(relationship, { strengthDelta, tensionDelta, at }) {
  normalizeRelationship(relationship);
  const previousStrength = relationship.strength;
  const previousTension = relationship.tension;
  relationship.strength = clamp(relationship.strength + strengthDelta);
  relationship.tension = clamp(relationship.tension + tensionDelta);
  relationship.interactionCount += 1;
  relationship.lastInteractionAt = new Date(at).toISOString();
  return {
    strengthDelta: relationship.strength - previousStrength,
    tensionDelta: relationship.tension - previousTension,
  };
}

export function applyCommitmentOutcome(relationship, outcome, at) {
  normalizeRelationship(relationship);
  if (outcome === "fulfilled") {
    return apply(relationship, {
      strengthDelta: strengthGain(relationship.strength, 2),
      tensionDelta: -6,
      at,
    });
  }
  if (outcome === "delayed") {
    return apply(relationship, { strengthDelta: -3, tensionDelta: 14, at });
  }
  if (outcome === "broken") {
    return apply(relationship, { strengthDelta: -6, tensionDelta: 24, at });
  }
  throw new RangeError(`Unsupported commitment outcome: ${outcome}`);
}

export function applySocialEncounter(relationship, at) {
  normalizeRelationship(relationship);
  if (relationship.tension >= 20) {
    return {
      tone: "tense",
      ...apply(relationship, { strengthDelta: -1, tensionDelta: -10, at }),
    };
  }
  if (relationship.tension >= 8) {
    return {
      tone: "repairing",
      ...apply(relationship, { strengthDelta: 0, tensionDelta: -8, at }),
    };
  }
  return {
    tone: "warm",
    ...apply(relationship, {
      strengthDelta: strengthGain(relationship.strength, 1),
      tensionDelta: -2,
      at,
    }),
  };
}
