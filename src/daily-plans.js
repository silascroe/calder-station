import { scriptedDecision } from "./scripted-decisions.js";

export const DAILY_PLAN_VERSION = 1;
export const PLAN_ACTIONS = Object.freeze(["work", "eat", "rest", "deliver", "observe"]);
export const OBLIGATION_CHOICES = Object.freeze(["fulfill", "report_delay"]);

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function relationshipFor(town, residentId, otherId) {
  return (town.relationships ?? []).find((relationship) => (
    (relationship.fromId === residentId && relationship.toId === otherId)
    || (relationship.fromId === otherId && relationship.toId === residentId)
  ));
}

function socialIntentionsFor(town, resident, action) {
  const candidates = (town.relationships ?? [])
    .filter((relationship) => relationship.fromId === resident.id || relationship.toId === resident.id)
    .map((relationship) => {
      const targetId = relationship.fromId === resident.id ? relationship.toId : relationship.fromId;
      const target = town.residents.find(({ id }) => id === targetId);
      return target ? { relationship, target } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.relationship.strength - left.relationship.strength || left.target.id.localeCompare(right.target.id));

  const preferred = candidates.find(({ target }) => (
    target.locationId === action.locationId || target.workLocationId === action.locationId
  )) ?? candidates[0];
  if (!preferred) return [];

  return [{
    type: "talk",
    targetId: preferred.target.id,
    locationId: action.locationId,
    relationship: preferred.relationship.kind,
    reason: `would like a word with ${preferred.target.name}`,
  }];
}

/**
 * The first planner implementation. It is deliberately deterministic, but it
 * returns a plan-shaped object so a model planner can replace it later.
 */
export function scriptedDailyPlan({ town, resident, now } = {}) {
  if (!town || !resident || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("scriptedDailyPlan requires town, resident, and valid Date");
  }

  const action = scriptedDecision({ resident, now });
  return {
    version: DAILY_PLAN_VERSION,
    residentId: resident.id,
    day: dayKey(now),
    source: "scripted",
    priorities: [action.action, "stay aware of local relationships"],
    actions: [{ ...action }],
    socialIntentions: socialIntentionsFor(town, resident, action),
  };
}

function validateAction(action, town) {
  if (!action || !PLAN_ACTIONS.includes(action.action)) {
    throw new RangeError(`Unsupported plan action: ${action?.action}`);
  }
  if (typeof action.locationId !== "string" || !town.locations.some(({ id }) => id === action.locationId)) {
    throw new RangeError(`Plan action targets an unknown location: ${action.locationId}`);
  }
  for (const field of ["reason", "status", "mood"]) {
    if (typeof action[field] !== "string" || action[field].length === 0 || action[field].length > 240) {
      throw new TypeError(`Plan action ${field} must be a non-empty string under 240 characters`);
    }
  }
}

/** Validate a planner response before the simulation can use it. */
export function validateDailyPlan(plan, { town, resident, now } = {}) {
  if (!plan || typeof plan !== "object") throw new TypeError("Daily plan must be an object");
  if (plan.version !== DAILY_PLAN_VERSION) throw new RangeError(`Unsupported daily plan version: ${plan.version}`);
  if (plan.residentId !== resident.id) throw new RangeError("Daily plan resident does not match the scheduled resident");
  if (plan.day !== dayKey(now)) throw new RangeError("Daily plan day does not match the decision time");
  if (plan.source !== "scripted" && plan.source !== "model") throw new RangeError("Daily plan source must be scripted or model");
  if (!Array.isArray(plan.priorities) || plan.priorities.length < 1 || plan.priorities.length > 4) {
    throw new RangeError("Daily plan priorities must contain between 1 and 4 items");
  }
  if (plan.priorities.some((priority) => typeof priority !== "string" || priority.length === 0 || priority.length > 120)) {
    throw new TypeError("Daily plan priorities must be short strings");
  }
  if (!Array.isArray(plan.actions) || plan.actions.length !== 1) {
    throw new RangeError("Daily plan must contain exactly one executable action in version 1");
  }
  plan.actions.forEach((action) => validateAction(action, town));
  const actionLocationId = plan.actions[0].locationId;
  if (!Array.isArray(plan.socialIntentions) || plan.socialIntentions.length > 2) {
    throw new RangeError("Daily plan may contain at most 2 social intentions");
  }
  for (const intention of plan.socialIntentions) {
    if (!intention || intention.type !== "talk" || typeof intention.targetId !== "string") {
      throw new RangeError("Unsupported social intention");
    }
    if (intention.targetId === resident.id || !town.residents.some(({ id }) => id === intention.targetId)) {
      throw new RangeError("Social intention targets an unknown resident");
    }
    if (typeof intention.locationId !== "string" || !town.locations.some(({ id }) => id === intention.locationId)) {
      throw new RangeError("Social intention targets an unknown location");
    }
    if (intention.locationId !== actionLocationId) {
      throw new RangeError("Social intention location must match the plan action location");
    }
    if (!relationshipFor(town, resident.id, intention.targetId)) {
      throw new RangeError("Social intention has no recorded relationship");
    }
  }
  if (plan.obligationDecision !== undefined) {
    const decision = plan.obligationDecision;
    if (!decision || typeof decision !== "object" || !OBLIGATION_CHOICES.includes(decision.choice)) {
      throw new RangeError(`Unsupported obligation choice: ${decision?.choice}`);
    }
    const obligation = (town.obligations ?? []).find(({ id }) => id === decision.obligationId);
    if (!obligation || obligation.status !== "open" || obligation.ownerId !== resident.id) {
      throw new RangeError("Daily plan references an unavailable obligation");
    }
    if (typeof decision.note !== "string" || decision.note.length === 0 || decision.note.length > 160) {
      throw new TypeError("Obligation decision note must be a non-empty string under 160 characters");
    }
    const action = plan.actions[0];
    if (decision.choice === "fulfill" && (action.action !== "deliver" || action.locationId !== obligation.destinationId)) {
      throw new RangeError("Fulfilling an obligation requires a delivery to its destination");
    }
    if (decision.choice === "report_delay" && action.action !== "observe") {
      throw new RangeError("Reporting an obligation delay requires an observe action");
    }
  }
  return plan;
}

/** Keep the old one-intent adapter usable while the new contract rolls in. */
export function normalizeDailyPlan(value, { town, resident, now } = {}) {
  const plan = Array.isArray(value?.actions)
    ? value
    : {
      version: DAILY_PLAN_VERSION,
      residentId: resident.id,
      day: dayKey(now),
      source: "scripted",
      priorities: [value?.action ?? "rest"],
      actions: [value],
      socialIntentions: [],
    };
  return validateDailyPlan(plan, { town, resident, now });
}
