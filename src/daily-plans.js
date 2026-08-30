import { scriptedDecision } from "./scripted-decisions.js";

export const DAILY_PLAN_VERSION = 3;
export const PLAN_ACTIONS = Object.freeze(["work", "eat", "rest", "deliver", "observe"]);
export const OBLIGATION_CHOICES = Object.freeze(["fulfill", "report_delay"]);
export const MAX_PLAN_ACTIONS = 5;
export const MAX_ACTION_OFFSET_MINUTES = 24 * 60;

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function minutesSinceUtcDay(value) {
  const date = new Date(value);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function offsetFromHour(now, hour) {
  if (!Number.isFinite(hour)) return null;
  const offset = Math.round(hour * 60 - minutesSinceUtcDay(now));
  return offset > 0 ? offset : null;
}

function routineAction({
  action,
  locationId,
  reason,
  status,
  mood,
  offsetMinutes,
}) {
  return {
    action,
    locationId,
    reason,
    status,
    mood,
    ...(offsetMinutes === undefined ? {} : { offsetMinutes }),
  };
}

function relationshipFor(town, residentId, otherId) {
  return (town.relationships ?? []).find((relationship) => (
    (relationship.fromId === residentId && relationship.toId === otherId)
    || (relationship.fromId === otherId && relationship.toId === residentId)
  ));
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function socialCandidates(town, resident) {
  const candidates = (town.relationships ?? [])
    .filter((relationship) => relationship.fromId === resident.id || relationship.toId === resident.id)
    .map((relationship) => {
      const targetId = relationship.fromId === resident.id ? relationship.toId : relationship.fromId;
      const target = town.residents.find(({ id }) => id === targetId);
      return target ? { relationship, target } : null;
    })
    .filter(Boolean)
    .sort((left, right) => (
      (left.relationship.interactionCount ?? 0) - (right.relationship.interactionCount ?? 0)
      || right.relationship.strength - left.relationship.strength
      || left.target.id.localeCompare(right.target.id)
    ));

  return candidates;
}

function socialIntentionsFor(town, resident, actions, now) {
  const candidates = socialCandidates(town, resident);
  const dayOrdinal = Math.floor(new Date(now).getTime() / (24 * 60 * 60 * 1000));
  const leastSeen = candidates[0];
  const needsIntroduction = (leastSeen?.relationship.interactionCount ?? 0) === 0;
  const needsRepair = (leastSeen?.relationship.tension ?? 0) >= 8;
  const socialDay = (dayOrdinal + stableHash(resident.id)) % 7 === 0;

  for (const { relationship, target } of candidates) {
    const actionIndex = actions.findIndex((action) => (
      action.action !== "rest"
      && (target.locationId === action.locationId || target.workLocationId === action.locationId)
    ));
    if (actionIndex === -1) continue;
    return [{
      type: "talk",
      targetId: target.id,
      actionIndex,
      locationId: actions[actionIndex].locationId,
      relationship: relationship.kind,
      reason: `would like a word with ${target.name}`,
    }];
  }

  if (!leastSeen || actions.length >= MAX_PLAN_ACTIONS || (!needsIntroduction && !needsRepair && !socialDay)) {
    return [];
  }

  const routine = leastSeen.target.routine ?? {};
  const possibleCalls = [
    {
      hour: Number.isFinite(routine.workStart) && Number.isFinite(routine.workEnd)
        ? (routine.workStart + routine.workEnd) / 2
        : null,
      locationId: leastSeen.target.workLocationId,
    },
    {
      hour: Number.isFinite(routine.mealStart) && Number.isFinite(routine.mealEnd)
        ? (routine.mealStart + routine.mealEnd) / 2
        : null,
      locationId: routine.mealLocationId ?? leastSeen.target.workLocationId,
    },
    {
      hour: Number.isFinite(routine.eveningStart) && Number.isFinite(routine.eveningEnd)
        ? (routine.eveningStart + routine.eveningEnd) / 2
        : null,
      locationId: routine.eveningLocationId,
    },
  ].map((candidate) => ({
    ...candidate,
    offsetMinutes: offsetFromHour(now, candidate.hour),
  })).filter((candidate) => candidate.locationId && candidate.offsetMinutes !== null);

  const call = possibleCalls.sort((left, right) => left.offsetMinutes - right.offsetMinutes)[0];
  if (!call) return [];

  const visit = routineAction({
    action: "observe",
    locationId: call.locationId,
    offsetMinutes: call.offsetMinutes,
    reason: `hoping to catch ${leastSeen.target.name}`,
    status: `Calling on ${leastSeen.target.name}`,
    mood: needsRepair ? "Uneasy" : "Curious",
  });
  actions.push(visit);
  actions.sort((left, right) => left.offsetMinutes - right.offsetMinutes);
  const actionIndex = actions.indexOf(visit);

  return [{
    type: "talk",
    targetId: leastSeen.target.id,
    actionIndex,
    locationId: visit.locationId,
    relationship: leastSeen.relationship.kind,
    reason: needsRepair
      ? `wants to clear the air with ${leastSeen.target.name}`
      : `is making time to call on ${leastSeen.target.name}`,
  }];
}

function addFutureRoutineAction(actions, now, candidate) {
  if (actions.length >= MAX_PLAN_ACTIONS) return;
  const offsetMinutes = offsetFromHour(now, candidate.hour);
  if (offsetMinutes === null) return;
  if (actions.some((action) => (
    action.action === candidate.action
    && action.locationId === candidate.locationId
    && action.offsetMinutes === offsetMinutes
  ))) return;
  actions.push(routineAction({ ...candidate, offsetMinutes }));
}

/**
 * The reference planner now returns a short ordered intention list. It does
 * not decide exact world time: offsets are authored from the resident's
 * routine and the executor turns them into queue entries.
 */
export function scriptedDailyPlan({ town, resident, now } = {}) {
  if (!town || !resident || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("scriptedDailyPlan requires town, resident, and valid Date");
  }

  const routine = resident.routine ?? {};
  const firstAction = scriptedDecision({ resident, now });
  const actions = [routineAction({ ...firstAction, offsetMinutes: 0 })];

  addFutureRoutineAction(actions, now, {
    hour: routine.workStart,
    action: routine.action ?? "work",
    locationId: resident.workLocationId,
    reason: routine.workReason ?? "the day's work is waiting",
    status: routine.workStatus ?? "Working through the day",
    mood: routine.workMood ?? "Focused",
  });
  addFutureRoutineAction(actions, now, {
    hour: routine.mealStart,
    action: "eat",
    locationId: routine.mealLocationId ?? resident.locationId,
    reason: routine.mealReason ?? "it is time for a meal",
    status: routine.mealStatus ?? "Stopping for a meal",
    mood: routine.mealMood ?? "Content",
  });
  if (routine.eveningAction) {
    addFutureRoutineAction(actions, now, {
      hour: routine.eveningStart,
      action: routine.eveningAction,
      locationId: routine.eveningLocationId ?? resident.locationId,
      reason: routine.eveningReason ?? "the evening is worth noticing",
      status: routine.eveningStatus ?? "Out for the evening",
      mood: routine.eveningMood ?? "Curious",
    });
  }
  addFutureRoutineAction(actions, now, {
    hour: routine.restStart ?? 23,
    action: "rest",
    locationId: resident.homeLocationId,
    reason: routine.restReason ?? "the day's work is finished",
    status: routine.restStatus ?? "Returning home for the night",
    mood: routine.restMood ?? "Calm",
  });

  actions.sort((left, right) => left.offsetMinutes - right.offsetMinutes);
  const socialIntentions = socialIntentionsFor(town, resident, actions, now);
  return {
    version: DAILY_PLAN_VERSION,
    residentId: resident.id,
    day: dayKey(now),
    source: "scripted",
    priorities: [actions[0].action, "complete the ordinary route", "remain available to local ties"],
    actions,
    socialIntentions,
  };
}

function validateAction(action, town) {
  if (!action || !PLAN_ACTIONS.includes(action.action)) {
    throw new RangeError(`Unsupported plan action: ${action?.action}`);
  }
  if (typeof action.locationId !== "string" || !town.locations.some(({ id }) => id === action.locationId)) {
    throw new RangeError(`Plan action targets an unknown location: ${action.locationId}`);
  }
  if (action.offsetMinutes !== undefined
    && (!Number.isInteger(action.offsetMinutes)
      || action.offsetMinutes < 0
      || action.offsetMinutes > MAX_ACTION_OFFSET_MINUTES)) {
    throw new RangeError(`Plan action offset must be an integer between 0 and ${MAX_ACTION_OFFSET_MINUTES}`);
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
  if (!Array.isArray(plan.actions) || plan.actions.length < 1 || plan.actions.length > MAX_PLAN_ACTIONS) {
    throw new RangeError(`Daily plan must contain between 1 and ${MAX_PLAN_ACTIONS} executable actions`);
  }
  plan.actions.forEach((action) => validateAction(action, town));
  const offsets = plan.actions.map((action, index) => action.offsetMinutes ?? index * 60);
  if (offsets[0] !== 0) {
    throw new RangeError("The first daily plan action must happen at the planning turn");
  }
  if (offsets.some((offset, index) => index > 0 && offset < offsets[index - 1])) {
    throw new RangeError("Daily plan action offsets must be non-decreasing");
  }
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
    const actionIndex = intention.actionIndex ?? 0;
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= plan.actions.length) {
      throw new RangeError("Social intention action index is outside the plan queue");
    }
    if (intention.locationId !== plan.actions[actionIndex].locationId) {
      throw new RangeError("Social intention location must match its queued plan action");
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
    const hasFulfillAction = plan.actions.some((action) => (
      action.action === (obligation.requiredAction ?? "deliver") && action.locationId === obligation.destinationId
    ));
    const hasDelayAction = plan.actions.some((action) => action.action === "observe");
    if (decision.choice === "fulfill" && !hasFulfillAction) {
      throw new RangeError("Fulfilling an obligation requires a delivery to its destination");
    }
    if (decision.choice === "report_delay" && !hasDelayAction) {
      throw new RangeError("Reporting an obligation delay requires an observe action");
    }
  }
  if (plan.obligationDecisions !== undefined) {
    if (!Array.isArray(plan.obligationDecisions) || plan.obligationDecisions.length < 1 || plan.obligationDecisions.length > 3) {
      throw new RangeError("Daily plan must contain between 1 and 3 queued obligation decisions");
    }
    const obligationIds = new Set();
    const actionIndexes = new Set();
    for (const decision of plan.obligationDecisions) {
      if (!decision || !Number.isInteger(decision.actionIndex)
        || decision.actionIndex < 0 || decision.actionIndex >= plan.actions.length) {
        throw new RangeError("Queued obligation decision has an invalid action index");
      }
      if (obligationIds.has(decision.obligationId) || actionIndexes.has(decision.actionIndex)) {
        throw new RangeError("Queued obligation decisions must use unique obligations and actions");
      }
      obligationIds.add(decision.obligationId);
      actionIndexes.add(decision.actionIndex);
      const obligation = (town.obligations ?? []).find(({ id }) => id === decision.obligationId);
      if (!obligation || obligation.status !== "open" || obligation.ownerId !== resident.id) {
        throw new RangeError("Queued obligation decision references an unavailable obligation");
      }
      if (!OBLIGATION_CHOICES.includes(decision.choice)
        || typeof decision.note !== "string" || decision.note.length < 1 || decision.note.length > 160) {
        throw new RangeError("Queued obligation decision must be a bounded obligation intent");
      }
      const action = plan.actions[decision.actionIndex];
      const matchesAction = decision.choice === "fulfill"
        ? action.action === (obligation.requiredAction ?? "deliver") && action.locationId === obligation.destinationId
        : action.action === "observe";
      if (!matchesAction) {
        throw new RangeError("Queued obligation decision does not match its executable action");
      }
    }
    if (plan.obligationDecision && !plan.obligationDecisions.some((decision) => (
      decision.obligationId === plan.obligationDecision.obligationId
      && decision.choice === plan.obligationDecision.choice
    ))) {
      throw new RangeError("Primary obligation decision is missing from the queued decisions");
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
