import { spreadDailyDecisionTimes } from "./scheduler.js";
import { TOWN_SEED_REVISION, townSeed } from "./demo-data.js";
import { normalizeDailyPlan } from "./daily-plans.js";
import {
  expireOverdueObligations,
  materializeObligation,
  renewObligations,
  resolveObligationDecision,
  scriptedObligationPlan,
} from "./obligations.js";
import {
  createDueCivicObligations,
  normalizeCivicIncidents,
  recordCivicOutcome,
} from "./civic-incidents.js";
import { normalizeRelationship } from "./relationship-dynamics.js";
import { resolveSocialIntentions } from "./social.js";
import { schedulePlanActions } from "./travel.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MINUTES = 60;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CANONICAL_SUMMARY = "A small town continuing under deterministic game-AI rules.";

export const DEFAULT_START_TIME = "2026-08-31T00:00:00.000Z";
export const DEFAULT_TICK_MINUTES = HOUR_MINUTES;
export const DEFAULT_PREVIEW_TICKS = 24;
export const MAX_PREVIEW_TICKS = 48;

const ACTIONS = new Set(["work", "eat", "rest", "deliver", "observe"]);

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatClock(date) {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function formatEventTime(date) {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function locationFor(state, locationId) {
  const location = (state.locations ?? []).find((candidate) => candidate.id === locationId);
  if (!location) throw new RangeError(`Unknown location: ${locationId}`);
  return location;
}

function residentIds(state) {
  return (state.residents ?? []).map(({ id }) => id);
}

function nextRoutineDecision(state, residentId, after, ids = residentIds(state)) {
  const reference = asDate(after);

  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    const day = new Date(Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate() + dayOffset,
    ));
    const slot = spreadDailyDecisionTimes({ day, residentIds: ids })
      .find((candidate) => candidate.residentId === residentId);

    if (slot && slot.scheduledAt > reference) return slot.scheduledAt;
  }

  throw new RangeError(`Unable to schedule resident: ${residentId}`);
}

function cloneTown(state) {
  return JSON.parse(JSON.stringify(state));
}

function decisionSnapshot(state, at) {
  // Planners only need recent context. Avoid copying the entire long-running
  // journal for every resident's planning turn.
  const snapshot = cloneTown({ ...state, events: state.events.slice(-8) });
  if (at) {
    const decisionAt = asDate(at);
    snapshot.now = decisionAt.toISOString();
    snapshot.clock = formatClock(decisionAt);
  }
  return snapshot;
}

function defaultStats() {
  return {
    tickCount: 0,
    decisionCount: 0,
    planCount: 0,
    actionCount: 0,
    interruptedActionCount: 0,
    modelCalls: 0,
    modelAttempts: 0,
    modelFallbacks: 0,
    modelCostSkips: 0,
    modelPromptTokens: 0,
    modelCompletionTokens: 0,
    modelPromptCacheHitTokens: 0,
    modelPromptCacheMissTokens: 0,
    eventCount: 0,
    encounterCount: 0,
    obligationCreatedCount: 0,
    obligationResolvedCount: 0,
    obligationFailedCount: 0,
    civicObligationCreatedCount: 0,
    conflictedPlanCount: 0,
  };
}

function appendEvent(state, {
  at,
  actorId = null,
  relatedActorId = null,
  locationId = null,
  relationshipId = null,
  relationshipDelta = null,
  tensionDelta = null,
  obligationId = null,
  action = null,
  type,
  text,
  source = "simulation",
  reason = null,
}) {
  const actor = actorId
    ? state.residents.find((resident) => resident.id === actorId)
    : null;
  const eventAt = asDate(at);
  const event = {
    id: `event-${String((state.stats.eventCount ?? 0) + 1).padStart(4, "0")}`,
    at: eventAt.toISOString(),
    time: formatEventTime(eventAt),
    actorId,
    actor: actor?.name ?? "Town",
    type,
    text,
    source,
  };

  if (reason) event.reason = reason;
  if (relatedActorId) event.relatedActorId = relatedActorId;
  if (locationId) event.locationId = locationId;
  if (relationshipId) event.relationshipId = relationshipId;
  if (Number.isFinite(relationshipDelta) && relationshipDelta !== 0) event.relationshipDelta = relationshipDelta;
  if (Number.isFinite(tensionDelta) && tensionDelta !== 0) event.tensionDelta = tensionDelta;
  if (obligationId) event.obligationId = obligationId;
  if (action) event.action = action;
  state.events.push(event);
  state.stats.eventCount = (state.stats.eventCount ?? 0) + 1;
  return event;
}

function updateLocation(resident, location) {
  resident.locationId = location.id;
  resident.location = location.name;
  resident.x = location.x;
  resident.y = location.y;
}

function applyNeeds(state, minutes) {
  if (minutes <= 0) return;
  const hours = minutes / HOUR_MINUTES;

  for (const resident of state.residents) {
    const resting = resident.lastAction === "rest";
    resident.energy = clamp(Math.round(resident.energy + (resting ? 4 : -2) * hours));
    resident.hunger = clamp(Math.round(resident.hunger + 2 * hours));
  }
}

function legalIntentFor(resident, intent) {
  if (intent.action !== "eat" && resident.hunger >= 94) {
    return {
      action: "eat",
      locationId: resident.locationId,
      reason: "hunger made the queued intention impossible to ignore",
      status: "Stopping to eat",
      mood: "Content",
    };
  }
  if (["work", "deliver", "observe"].includes(intent.action) && resident.energy <= 12) {
    return {
      action: "rest",
      locationId: resident.homeLocationId,
      reason: "energy made the queued intention impossible to carry out",
      status: "Taking a necessary rest",
      mood: "Calm",
    };
  }
  return intent;
}

function normalizeRuntimeState(state) {
  state.events ??= [];
  state.locations ??= [];
  state.residents ??= [];
  state.relationships ??= [];
  state.obligations ??= [];
  const storedStats = state.stats ?? {};
  const hasStored = (field) => storedStats[field] !== undefined && storedStats[field] !== null;
  state.stats = { ...defaultStats(), ...storedStats };
  if (!hasStored("eventCount")) state.stats.eventCount = state.events.length;
  if (!hasStored("planCount")) state.stats.planCount = hasStored("decisionCount") ? storedStats.decisionCount : 0;
  if (!hasStored("decisionCount")) state.stats.decisionCount = hasStored("planCount") ? storedStats.planCount : 0;
  if (!hasStored("actionCount")) {
    state.stats.actionCount = state.residents.reduce(
      (total, resident) => total + (resident.actionCount ?? resident.decisionCount ?? 0),
      0,
    );
  }
  if (!hasStored("obligationCreatedCount")) state.stats.obligationCreatedCount = state.obligations.length;
  if (!hasStored("obligationResolvedCount")) {
    state.stats.obligationResolvedCount = state.obligations.filter(({ status }) => (
      status === "fulfilled" || status === "delayed"
    )).length;
  }
  if (!hasStored("obligationFailedCount")) {
    state.stats.obligationFailedCount = state.obligations.filter(({ status }) => status === "broken").length;
  }

  for (const resident of state.residents) {
    resident.planCount ??= resident.decisionCount ?? 0;
    resident.decisionCount ??= resident.planCount;
    resident.actionCount ??= resident.decisionCount;
    resident.interruptedActionCount ??= 0;
    resident.lastAction ??= "rest";
    resident.lastDecisionAt ??= null;
    resident.dailyPlan ??= null;
    resident.actionQueue = Array.isArray(resident.actionQueue) ? resident.actionQueue : [];
    if (resident.nextDecisionAt && resident.nextPlanAt && resident.nextDecisionAt !== resident.nextPlanAt) {
      // Keep callers that still set the v1 compatibility field working while
      // stored projections migrate to the explicit planning-turn name.
      resident.nextPlanAt = resident.nextDecisionAt;
    }
    resident.nextPlanAt ??= resident.nextDecisionAt ?? null;
    if (!resident.nextPlanAt) {
      resident.nextPlanAt = nextRoutineDecision(state, resident.id, state.now).toISOString();
    }
    resident.nextDecisionAt = resident.nextPlanAt;
    resident.nextActionAt = resident.actionQueue[0]?.scheduledAt ?? null;
    resident.lastEncounterAt ??= null;
    resident.lastEncounterWithId ??= null;
    resident.socialCount ??= 0;
  }

  state.obligations = state.obligations.map((obligation) => (
    materializeObligation(obligation, state.startedAt ?? state.now)
  ));
  state.relationships.forEach(normalizeRelationship);
  normalizeCivicIncidents(state);
  return state;
}

function resolveAction(state, resident, intent, actionAt, source = "scripted", metadata = {}) {
  if (!intent || !ACTIONS.has(intent.action)) {
    throw new RangeError(`Unsupported scripted action: ${intent?.action}`);
  }

  const legalIntent = legalIntentFor(resident, intent);
  if (legalIntent.action !== intent.action || legalIntent.locationId !== intent.locationId) {
    resident.interruptedActionCount += 1;
    state.stats.interruptedActionCount += 1;
    appendEvent(state, {
      at: actionAt,
      actorId: resident.id,
      locationId: resident.locationId,
      action: intent.action,
      type: "action-interrupted",
      text: `changed a queued ${intent.action} intention to ${legalIntent.action}`,
      source: "simulation",
      reason: legalIntent.reason,
    });
  }

  const target = locationFor(state, legalIntent.locationId || resident.locationId);
  const previousLocation = locationFor(state, resident.locationId);

  if (previousLocation.id !== target.id) {
    updateLocation(resident, target);
    appendEvent(state, {
      at: actionAt,
      actorId: resident.id,
      locationId: target.id,
      type: "movement",
      text: `walked from ${previousLocation.name} to ${target.name}`,
      source,
    });
  }

  if (legalIntent.action === "work") {
    resident.energy = clamp(resident.energy - 8);
  } else if (legalIntent.action === "eat") {
    resident.hunger = clamp(resident.hunger - 38);
    resident.energy = clamp(resident.energy + 3);
  } else if (legalIntent.action === "rest") {
    resident.energy = clamp(resident.energy + 12);
  } else if (legalIntent.action === "deliver") {
    resident.energy = clamp(resident.energy - 6);
  } else if (legalIntent.action === "observe") {
    resident.energy = clamp(resident.energy - 2);
  }

  resident.status = legalIntent.status;
  resident.mood = legalIntent.mood;
  resident.lastAction = legalIntent.action;
  resident.lastDecisionAt = asDate(actionAt).toISOString();
  resident.actionCount += 1;
  state.stats.actionCount += 1;

  const actionText = {
    work: `started work at ${target.name}`,
    eat: `stopped to eat at ${target.name}`,
    rest: `settled in to rest at ${target.name}`,
    deliver: `took a delivery route through ${target.name}`,
    observe: `watched ${target.name} for anything unusual`,
  }[legalIntent.action];

  appendEvent(state, {
    at: actionAt,
    actorId: resident.id,
    locationId: target.id,
    action: legalIntent.action,
    type: "decision",
    text: actionText,
    source,
    reason: legalIntent.reason,
  });

  return { ...metadata, actualIntent: legalIntent };
}

function modelTelemetryFor(plan) {
  const telemetry = plan.modelTelemetry;
  const promptTokens = telemetry && Number.isSafeInteger(telemetry.promptTokens) && telemetry.promptTokens >= 0
    ? telemetry.promptTokens
    : 0;
  const completionTokens = telemetry && Number.isSafeInteger(telemetry.completionTokens) && telemetry.completionTokens >= 0
    ? telemetry.completionTokens
    : 0;
  return { telemetry, promptTokens, completionTokens };
}

function recordPlanTelemetry(state, resident, plan, planAt) {
  const { telemetry, promptTokens, completionTokens } = modelTelemetryFor(plan);
  if (telemetry?.skipped) {
    state.stats.modelCostSkips += 1;
    return;
  }
  if (!telemetry?.attempted) return;

  state.stats.modelAttempts += 1;
  state.stats.modelPromptTokens += promptTokens;
  state.stats.modelCompletionTokens += completionTokens;
  state.stats.modelPromptCacheHitTokens += Number.isSafeInteger(telemetry.promptCacheHitTokens)
    ? telemetry.promptCacheHitTokens
    : 0;
  state.stats.modelPromptCacheMissTokens += Number.isSafeInteger(telemetry.promptCacheMissTokens)
    ? telemetry.promptCacheMissTokens
    : 0;
  if (telemetry.fallback) {
    state.stats.modelFallbacks += 1;
    appendEvent(state, {
      at: planAt,
      actorId: resident.id,
      locationId: plan.actions[0].locationId,
      type: "model-fallback",
      text: "used the scripted fallback after the model could not return a valid plan",
      source: "model-fallback",
      reason: telemetry.errorCode ?? "unknown model error",
    });
  }
}

function queueEntryFor(resident, plan, action, sequence, timing) {
  const obligationDecision = plan.obligationDecisions?.find(({ actionIndex }) => actionIndex === sequence)
    ?? (sequence === 0 ? plan.obligationDecision : null);
  return {
    id: `${resident.id}-plan-${resident.planCount}-action-${sequence + 1}`,
    sequence,
    plannedAt: timing.plannedAt,
    scheduledAt: timing.scheduledAt,
    travelMinutes: timing.travelMinutes,
    serviceMinutes: timing.serviceMinutes,
    intent: {
      action: action.action,
      locationId: action.locationId,
      reason: action.reason,
      status: action.status,
      mood: action.mood,
    },
    source: plan.source,
    socialIntentions: plan.socialIntentions
      .filter((intention) => (intention.actionIndex ?? 0) === sequence)
      .map((intention) => ({ ...intention })),
    obligationDecision: obligationDecision
      ? { ...obligationDecision }
      : null,
  };
}

function queuePlanActions(state, resident, plan, planAt) {
  const interrupted = resident.actionQueue.length;
  if (interrupted > 0) {
    resident.interruptedActionCount += interrupted;
    state.stats.interruptedActionCount += interrupted;
    appendEvent(state, {
      at: planAt,
      actorId: resident.id,
      locationId: resident.locationId,
      type: "action-interrupted",
      text: `set aside ${interrupted} queued intention${interrupted === 1 ? "" : "s"} for a new daily plan`,
      source: "simulation",
      reason: "the next planning turn replaced unfinished intentions",
    });
  }

  const timings = schedulePlanActions(state, resident, plan.actions, planAt);
  resident.actionQueue = plan.actions.map((action, sequence) => (
    queueEntryFor(resident, plan, action, sequence, timings[sequence])
  ));
  resident.nextActionAt = resident.actionQueue[0]?.scheduledAt ?? null;
}

async function executePlan(state, resident, decisionAdapter, planAt) {
  const competingObligationCount = state.obligations.filter((obligation) => (
    obligation.ownerId === resident.id && obligation.status === "open"
  )).length;
  const rawPlan = await decisionAdapter({
    town: decisionSnapshot(state, planAt),
    resident: { ...resident },
    now: planAt,
  });

  const plan = normalizeDailyPlan(rawPlan, {
    town: state,
    resident,
    now: planAt,
  });
  const { telemetry, promptTokens, completionTokens } = modelTelemetryFor(plan);
  recordPlanTelemetry(state, resident, plan, planAt);

  resident.planCount += 1;
  resident.decisionCount = resident.planCount;
  state.stats.planCount += 1;
  state.stats.decisionCount += 1;
  if (competingObligationCount > 1) state.stats.conflictedPlanCount += 1;
  if (plan.source === "model") state.stats.modelCalls += 1;

  resident.dailyPlan = {
    version: plan.version,
    day: plan.day,
    source: plan.source,
    priorities: [...plan.priorities],
    action: plan.actions[0].action,
    locationId: plan.actions[0].locationId,
    reason: plan.actions[0].reason,
    actionCount: plan.actions.length,
    actions: plan.actions.map((action) => ({ ...action })),
    socialIntentions: plan.socialIntentions.map((intention) => ({ ...intention })),
    obligationDecision: plan.obligationDecision ? { ...plan.obligationDecision } : null,
    obligationDecisions: plan.obligationDecisions?.map((decision) => ({ ...decision })) ?? null,
    competingObligationCount,
    model: telemetry ? {
      attempted: Boolean(telemetry.attempted),
      fallback: Boolean(telemetry.fallback),
      skipped: Boolean(telemetry.skipped),
      policyReason: telemetry.policyReason ?? null,
      model: telemetry.model ?? null,
      requestId: telemetry.requestId ?? null,
      promptTokens,
      completionTokens,
      promptCacheHitTokens: telemetry.promptCacheHitTokens ?? 0,
      promptCacheMissTokens: telemetry.promptCacheMissTokens ?? 0,
      totalTokens: telemetry.totalTokens ?? null,
      errorCode: telemetry.errorCode ?? null,
    } : null,
  };

  resident.nextPlanAt = nextRoutineDecision(state, resident.id, planAt).toISOString();
  resident.nextDecisionAt = resident.nextPlanAt;
  queuePlanActions(state, resident, plan, planAt);
}

function appendObligationOutcome(state, outcome, at, source) {
  appendEvent(state, {
    ...outcome,
    at,
    source: outcome.source ?? source,
    obligationId: outcome.obligationId,
  });

  const obligation = state.obligations.find(({ id }) => id === outcome.obligationId);
  if (!obligation) return;
  if (obligation.status === "broken") state.stats.obligationFailedCount += 1;
  else if (obligation.status === "fulfilled" || obligation.status === "delayed") {
    state.stats.obligationResolvedCount += 1;
  }
  recordCivicOutcome(state, obligation, at);
}

function recordRenewals(state, at) {
  const created = renewObligations(state, at);
  for (const obligation of created) {
    state.stats.obligationCreatedCount += 1;
    appendEvent(state, {
      at,
      actorId: obligation.ownerId,
      relatedActorId: obligation.counterpartyId,
      locationId: obligation.destinationId,
      obligationId: obligation.id,
      type: "obligation-created",
      text: `received a new obligation: ${obligation.title}`,
      source: "renewal",
      reason: `continuation of ${obligation.seriesId}`,
    });
  }
}

function recordCivicRequests(state, at) {
  const created = createDueCivicObligations(state, at);
  for (const obligation of created) {
    state.stats.obligationCreatedCount += 1;
    state.stats.civicObligationCreatedCount += 1;
    appendEvent(state, {
      at,
      actorId: obligation.ownerId,
      relatedActorId: obligation.counterpartyId,
      locationId: obligation.destinationId,
      obligationId: obligation.id,
      type: "obligation-created",
      text: `accepted a civic commitment: ${obligation.title}`,
      source: "civic-incident",
      reason: obligation.description,
    });
  }
}

function advanceCausalState(state, at) {
  for (const outcome of expireOverdueObligations(state, at)) {
    appendObligationOutcome(state, outcome, at, "simulation");
  }
  recordRenewals(state, at);
  recordCivicRequests(state, at);
}

function executeAction(state, resident, entry, actionAt) {
  resident.actionQueue.shift();
  resident.nextActionAt = resident.actionQueue[0]?.scheduledAt ?? null;
  const queuedObligation = entry.obligationDecision
    ? state.obligations.find(({ id }) => id === entry.obligationDecision.obligationId)
    : null;
  if (entry.obligationDecision && queuedObligation?.status !== "open") {
    resident.interruptedActionCount += 1;
    state.stats.interruptedActionCount += 1;
    appendEvent(state, {
      at: actionAt,
      actorId: resident.id,
      relatedActorId: queuedObligation?.counterpartyId ?? null,
      locationId: resident.locationId,
      obligationId: entry.obligationDecision.obligationId,
      action: entry.intent.action,
      type: "action-interrupted",
      text: `set aside ${queuedObligation?.title ?? "a queued commitment"}`,
      source: "simulation",
      reason: `the commitment was already ${queuedObligation?.status ?? "unavailable"}`,
    });
    return;
  }
  const { actualIntent } = resolveAction(state, resident, entry.intent, actionAt, entry.source, entry);

  if (entry.obligationDecision) {
    const obligation = state.obligations.find(({ id }) => id === entry.obligationDecision.obligationId);
    const requiredAction = entry.obligationDecision.choice === "fulfill"
      ? obligation?.requiredAction ?? "deliver"
      : "observe";
    if (actualIntent.action === requiredAction && obligation?.status === "open") {
      const obligationEvent = resolveObligationDecision(state, resident, {
        obligationDecision: entry.obligationDecision,
      }, actionAt);
      if (obligationEvent) appendObligationOutcome(state, obligationEvent, actionAt, entry.source);
    } else {
      appendEvent(state, {
        at: actionAt,
        actorId: resident.id,
        relatedActorId: obligation?.counterpartyId ?? null,
        locationId: resident.locationId,
        obligationId: entry.obligationDecision.obligationId,
        type: "obligation",
        text: obligation?.status === "open"
          ? `could not act on ${obligation.title} during the queued window`
          : `could not resolve ${obligation?.title ?? "the obligation"} before it expired`,
        source: "simulation",
        reason: obligation?.status === "open"
          ? "ordinary needs interrupted the required action"
          : "the queued intention arrived after the due time",
      });
    }
  }

  const plan = {
    socialIntentions: entry.socialIntentions ?? [],
  };
  const encounters = resolveSocialIntentions(state, resident, plan, actionAt);
  for (const encounter of encounters) {
    appendEvent(state, {
      at: actionAt,
      actorId: encounter.actorId,
      relatedActorId: encounter.targetId,
      locationId: encounter.locationId,
      relationshipId: encounter.relationshipId,
      relationshipDelta: encounter.relationshipDelta,
      tensionDelta: encounter.tensionDelta,
      type: encounter.type,
      text: encounter.text,
      source: entry.source,
      reason: encounter.reason,
    });
    state.stats.encounterCount += 1;
  }
}

function simulationDay(startedAt, now) {
  return Math.floor((asDate(now).getTime() - asDate(startedAt).getTime()) / DAY_MS) + 1;
}

function residentStateFromSeed(state, residentSeed, scheduledAfter, ids, status = "Asleep at home") {
  const location = locationFor(state, residentSeed.initialLocationId);
  const resident = {
    ...residentSeed,
    ...(residentSeed.routine ? { routine: { ...residentSeed.routine } } : {}),
    locationId: location.id,
    location: location.name,
    x: location.x,
    y: location.y,
    status,
    planCount: 0,
    decisionCount: 0,
    actionCount: 0,
    interruptedActionCount: 0,
    lastAction: "rest",
    lastDecisionAt: null,
    nextPlanAt: null,
    nextDecisionAt: null,
    nextActionAt: null,
    actionQueue: [],
    dailyPlan: null,
    lastEncounterAt: null,
    lastEncounterWithId: null,
    socialCount: 0,
  };
  resident.nextPlanAt = nextRoutineDecision(state, resident.id, scheduledAfter, ids).toISOString();
  resident.nextDecisionAt = resident.nextPlanAt;
  return resident;
}

export function createInitialTown({
  seed = "calder-station-day-one",
  startTime = DEFAULT_START_TIME,
  seedData = townSeed,
  environment = "preview",
} = {}) {
  if (!seedData || !Array.isArray(seedData.locations) || !Array.isArray(seedData.residents)) {
    throw new TypeError("seedData must include locations and residents arrays");
  }

  const startedAt = asDate(startTime);
  const state = {
    id: seedData.id,
    name: seedData.name,
    environment,
    mode: "scripted-simulation-preview",
    persistence: "ephemeral",
    seed,
    seedRevision: TOWN_SEED_REVISION,
    startedAt: startedAt.toISOString(),
    now: startedAt.toISOString(),
    day: 1,
    clock: formatClock(startedAt),
    weather: seedData.weather,
    summary: "A replayable town simulation driven by bounded game-AI rules.",
    locations: seedData.locations.map((location) => ({ ...location })),
    residents: [],
    relationships: (seedData.relationships ?? []).map((relationship) => normalizeRelationship({ ...relationship })),
    obligations: (seedData.obligations ?? []).map((obligation) => (
      materializeObligation(obligation, startedAt)
    )),
    civicIncidents: null,
    events: [],
    stats: defaultStats(),
  };
  state.stats.obligationCreatedCount = state.obligations.length;
  normalizeCivicIncidents(state);

  const ids = seedData.residents.map(({ id }) => id);
  state.residents = seedData.residents.map((residentSeed) => (
    residentStateFromSeed(state, residentSeed, startedAt, ids)
  ));

  appendEvent(state, {
    at: startedAt,
    type: "system",
    text: `${seedData.name}'s first day began`,
    source: "simulation",
  });

  return state;
}

function duePlanCandidate(state, to) {
  return state.residents
    .filter((resident) => resident.nextPlanAt && asDate(resident.nextPlanAt) <= to)
    .sort((left, right) => {
      const atDifference = asDate(left.nextPlanAt) - asDate(right.nextPlanAt);
      return atDifference || left.id.localeCompare(right.id);
    })[0] ?? null;
}

function dueActionCandidate(state, to) {
  return state.residents
    .filter((resident) => resident.actionQueue[0]?.scheduledAt)
    .filter((resident) => asDate(resident.actionQueue[0].scheduledAt) <= to)
    .sort((left, right) => {
      const atDifference = asDate(left.actionQueue[0].scheduledAt)
        - asDate(right.actionQueue[0].scheduledAt);
      return atDifference || left.id.localeCompare(right.id);
    })[0] ?? null;
}

function chooseDueWork(state, to) {
  const planResident = duePlanCandidate(state, to);
  const actionResident = dueActionCandidate(state, to);
  if (!planResident) return actionResident ? { kind: "action", resident: actionResident } : null;
  if (!actionResident) return { kind: "plan", resident: planResident };

  const planAt = asDate(planResident.nextPlanAt);
  const actionAt = asDate(actionResident.actionQueue[0].scheduledAt);
  if (planAt <= actionAt) return { kind: "plan", resident: planResident };
  return { kind: "action", resident: actionResident };
}

export async function advanceTown(state, {
  minutes = DEFAULT_TICK_MINUTES,
  decisionAdapter = scriptedObligationPlan,
} = {}) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * HOUR_MINUTES) {
    throw new RangeError("minutes must be an integer between 1 and 1440");
  }
  if (typeof decisionAdapter !== "function") {
    throw new TypeError("decisionAdapter must be a function");
  }

  const next = normalizeRuntimeState(cloneTown(state));
  const from = asDate(next.now);
  const to = new Date(from.getTime() + minutes * MINUTE_MS);
  let cursor = from;

  advanceCausalState(next, from);

  while (true) {
    const work = chooseDueWork(next, to);
    if (!work) break;

    const scheduledAt = work.kind === "plan"
      ? asDate(work.resident.nextPlanAt)
      : asDate(work.resident.actionQueue[0].scheduledAt);
    const effectiveAt = scheduledAt < cursor ? cursor : scheduledAt;
    applyNeeds(next, (effectiveAt.getTime() - cursor.getTime()) / MINUTE_MS);
    advanceCausalState(next, effectiveAt);

    if (work.kind === "plan") {
      await executePlan(next, work.resident, decisionAdapter, effectiveAt);
    } else {
      executeAction(next, work.resident, work.resident.actionQueue[0], effectiveAt);
    }
    cursor = effectiveAt;
  }

  applyNeeds(next, (to.getTime() - cursor.getTime()) / MINUTE_MS);
  advanceCausalState(next, to);
  next.now = to.toISOString();
  next.day = simulationDay(next.startedAt, to);
  next.clock = formatClock(to);
  next.stats.tickCount += 1;
  for (const resident of next.residents) {
    resident.nextDecisionAt = resident.nextPlanAt;
    resident.nextActionAt = resident.actionQueue[0]?.scheduledAt ?? null;
  }
  return next;
}

/**
 * Idempotently brings a persisted projection up to the current authored seed
 * without replacing evolved needs, queues, relationships, or history.
 */
export function reconcileTownWithSeed(state, { seedData = townSeed } = {}) {
  const runtimeBackfillNeeded = !state.civicIncidents
    || (state.relationships ?? []).some((relationship) => (
      relationship.baselineStrength === undefined
      || relationship.tension === undefined
      || relationship.interactionCount === undefined
    ))
    || (state.obligations ?? []).some((obligation) => obligation.requiredAction === undefined)
    || state.stats?.civicObligationCreatedCount === undefined
    || state.stats?.conflictedPlanCount === undefined;
  const next = normalizeRuntimeState(cloneTown(state));
  const previousSeedRevision = Number(next.seedRevision ?? 0);
  let metadataChanged = previousSeedRevision !== TOWN_SEED_REVISION || runtimeBackfillNeeded;
  const changes = { locations: 0, residents: 0, relationships: 0, obligations: 0 };
  let authoredCopyChanged = false;

  if (next.id !== seedData.id) {
    next.id = seedData.id;
    metadataChanged = true;
  }
  if (next.name !== seedData.name) {
    next.name = seedData.name;
    authoredCopyChanged = true;
  }
  if (next.weather !== seedData.weather) {
    next.weather = seedData.weather;
    authoredCopyChanged = true;
  }
  if (!next.summary || next.summary !== CANONICAL_SUMMARY) {
    next.summary = CANONICAL_SUMMARY;
    authoredCopyChanged = true;
  }

  const locationsById = new Map(next.locations.map((location) => [location.id, location]));
  for (const locationSeed of seedData.locations) {
    const existing = locationsById.get(locationSeed.id);
    if (!existing) {
      next.locations.push({ ...locationSeed });
      locationsById.set(locationSeed.id, next.locations.at(-1));
      changes.locations += 1;
      continue;
    }
    for (const field of ["name", "type", "x", "y"]) {
      if (existing[field] !== locationSeed[field]) {
        existing[field] = locationSeed[field];
        authoredCopyChanged = true;
      }
    }
  }

  const residentIdsInState = new Set(next.residents.map(({ id }) => id));
  const allResidentIds = seedData.residents.map(({ id }) => id);
  const residentSeeds = new Map(seedData.residents.map((resident) => [resident.id, resident]));
  for (const resident of next.residents) {
    const seed = residentSeeds.get(resident.id);
    if (!seed) continue;
    for (const field of ["name", "portraitKey", "role", "homeLocationId", "workLocationId", "initialLocationId"]) {
      if (resident[field] !== seed[field]) {
        resident[field] = seed[field];
        authoredCopyChanged = true;
      }
    }
    if (previousSeedRevision < TOWN_SEED_REVISION && seed.routine) {
      const routine = JSON.stringify(seed.routine);
      if (JSON.stringify(resident.routine ?? null) !== routine) {
        resident.routine = cloneTown(seed.routine);
        authoredCopyChanged = true;
      }
    }
    if (!locationsById.has(resident.locationId)) {
      updateLocation(resident, locationsById.get(seed.initialLocationId));
      authoredCopyChanged = true;
    } else {
      updateLocation(resident, locationsById.get(resident.locationId));
    }
  }
  for (const residentSeed of seedData.residents) {
    if (residentIdsInState.has(residentSeed.id)) continue;
    next.residents.push(residentStateFromSeed(
      next,
      residentSeed,
      next.now,
      allResidentIds,
      "Settling into town",
    ));
    residentIdsInState.add(residentSeed.id);
    changes.residents += 1;
  }

  const relationshipIds = new Set(next.relationships.map(({ id }) => id));
  for (const relationship of seedData.relationships ?? []) {
    if (relationshipIds.has(relationship.id)) continue;
    next.relationships.push({ ...relationship });
    relationshipIds.add(relationship.id);
    changes.relationships += 1;
  }

  const obligationIds = new Set(next.obligations.map(({ id }) => id));
  const obligationSeeds = new Map((seedData.obligations ?? []).map((obligation) => [obligation.id, obligation]));
  for (const obligation of next.obligations) {
    const seed = obligationSeeds.get(obligation.id);
    if (!seed) continue;
    for (const field of [
      "kind",
      "ownerId",
      "counterpartyId",
      "destinationId",
      "title",
      "description",
      "dueAfterMinutes",
      "renewable",
      "seriesId",
    ]) {
      if (obligation[field] !== seed[field]) {
        obligation[field] = seed[field];
        authoredCopyChanged = true;
      }
    }
    obligation.generation ??= seed.generation ?? 0;
    obligation.parentObligationId ??= null;
  }
  for (const obligationSeed of seedData.obligations ?? []) {
    if (obligationIds.has(obligationSeed.id)) continue;
    next.obligations.push(materializeObligation(obligationSeed, next.startedAt));
    obligationIds.add(obligationSeed.id);
    changes.obligations += 1;
  }
  next.stats.obligationCreatedCount += changes.obligations;

  next.seedRevision = TOWN_SEED_REVISION;
  const additions = [];
  if (changes.residents) additions.push(`${changes.residents} residents`);
  if (changes.locations) additions.push(`${changes.locations} places`);
  if (changes.relationships) additions.push(`${changes.relationships} relationships`);
  if (changes.obligations) additions.push(`${changes.obligations} obligation${changes.obligations === 1 ? "" : "s"}`);
  const additionsChanged = additions.length > 0;
  const changed = additionsChanged || authoredCopyChanged;
  if (changed) {
    const text = additionsChanged
      ? `the town register added ${additions.join(" and ")}`
      : "the town register adopted its current names and authored details";
    appendEvent(next, {
      at: next.now,
      type: "system",
      source: "migration",
      text,
    });
  }

  return {
    state: next,
    changed,
    needsPersist: changed || metadataChanged,
    changes,
  };
}

export async function runPreview({
  ticks = DEFAULT_PREVIEW_TICKS,
  tickMinutes = DEFAULT_TICK_MINUTES,
  seed,
  startTime,
  seedData,
} = {}) {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_PREVIEW_TICKS) {
    throw new RangeError(`ticks must be an integer between 0 and ${MAX_PREVIEW_TICKS}`);
  }

  let state = createInitialTown({ seed, startTime, seedData });
  for (let tick = 0; tick < ticks; tick += 1) {
    state = await advanceTown(state, { minutes: tickMinutes });
  }
  return state;
}

export function townView(state) {
  const view = cloneTown(state);
  delete view.events;
  return view;
}

export function eventView(state) {
  return cloneTown(state.events).reverse();
}

export function previewOptions(url) {
  const rawTicks = url.searchParams.get("ticks");
  if (rawTicks === null || rawTicks === "") return { ticks: DEFAULT_PREVIEW_TICKS };
  if (!/^\d+$/.test(rawTicks)) throw new RangeError("ticks must be a non-negative integer");

  const ticks = Number(rawTicks);
  if (!Number.isSafeInteger(ticks) || ticks > MAX_PREVIEW_TICKS) {
    throw new RangeError(`ticks must be an integer between 0 and ${MAX_PREVIEW_TICKS}`);
  }
  return { ticks };
}
