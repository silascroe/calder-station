import { townSeed } from "./demo-data.js";
import {
  DEFAULT_START_TIME,
  advanceTown,
  createInitialTown,
} from "./simulation.js";
import { scriptedObligationPlan } from "./obligations.js";

const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;
const DEFAULT_CHECKPOINTS = Object.freeze([1, 7, 30, 90]);
const MAX_SCENARIO_DAYS = 365;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return date;
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function eventCounts(events) {
  return events.reduce((counts, event) => {
    increment(counts, event.type ?? "unknown");
    return counts;
  }, {});
}

function eventDiversity(events) {
  const templates = new Map();
  for (const event of events) {
    const key = `${event.type ?? "unknown"}:${event.text ?? ""}`;
    templates.set(key, (templates.get(key) ?? 0) + 1);
  }
  const ranked = [...templates.entries()]
    .map(([template, count]) => ({ template, count }))
    .sort((left, right) => right.count - left.count || left.template.localeCompare(right.template));
  const topTenCount = ranked.slice(0, 10).reduce((total, item) => total + item.count, 0);
  const meaningfulTypes = new Set([
    "encounter",
    "obligation",
    "obligation-created",
    "action-interrupted",
    "model-fallback",
    "reflection",
    "reflection-fallback",
  ]);
  return {
    total: events.length,
    uniqueTemplates: templates.size,
    topTenShare: events.length === 0 ? 0 : topTenCount / events.length,
    meaningfulEvents: events.filter(({ type }) => meaningfulTypes.has(type)).length,
    topTemplates: ranked.slice(0, 10),
  };
}

function dailyPatternDiagnostics(state) {
  const decisions = (state.events ?? []).filter((event) => event.type === "decision" && event.actorId);
  const byResidentDay = new Map();
  for (const event of decisions) {
    const key = `${event.actorId}:${String(event.at).slice(0, 10)}`;
    const signature = byResidentDay.get(key) ?? [];
    signature.push(`${event.action ?? "unknown"}@${event.locationId ?? "unknown"}`);
    byResidentDay.set(key, signature);
  }

  return Object.fromEntries(state.residents.map((resident) => {
    const signatures = [...byResidentDay.entries()]
      .filter(([key]) => key.startsWith(`${resident.id}:`))
      .map(([, actions]) => actions.join("|"));
    const counts = signatures.reduce((result, signature) => {
      increment(result, signature);
      return result;
    }, {});
    const dominant = Object.entries(counts)
      .map(([signature, count]) => ({ signature, count }))
      .sort((left, right) => right.count - left.count || left.signature.localeCompare(right.signature))[0] ?? null;
    return [resident.id, {
      name: resident.name,
      daysObserved: signatures.length,
      uniquePatterns: Object.keys(counts).length,
      dominantPattern: dominant?.signature ?? null,
      dominantDays: dominant?.count ?? 0,
      dominantShare: signatures.length === 0 ? 0 : (dominant?.count ?? 0) / signatures.length,
    }];
  }));
}

function relationshipDynamics(initial, state) {
  const initialById = new Map(initial.relationships.map((relationship) => [relationship.id, relationship]));
  const sociallyEncountered = new Set(
    (state.events ?? [])
      .filter(({ type, relationshipId }) => type === "encounter" && relationshipId)
      .map(({ relationshipId }) => relationshipId),
  );
  const causallyActive = new Set(
    (state.events ?? [])
      .filter(({ type, relationshipId }) => ["encounter", "obligation"].includes(type) && relationshipId)
      .map(({ relationshipId }) => relationshipId),
  );
  const directions = { increased: 0, decreased: 0, unchanged: 0 };
  const saturated = [];
  const strained = [];
  for (const relationship of state.relationships) {
    const before = initialById.get(relationship.id)?.strength ?? relationship.strength;
    if (relationship.strength > before) directions.increased += 1;
    else if (relationship.strength < before) directions.decreased += 1;
    else directions.unchanged += 1;
    if (relationship.strength >= 95 || relationship.strength <= 5) {
      saturated.push({
        id: relationship.id,
        fromId: relationship.fromId,
        toId: relationship.toId,
        strength: relationship.strength,
      });
    }
    if ((relationship.tension ?? 0) >= 20) {
      strained.push({
        id: relationship.id,
        fromId: relationship.fromId,
        toId: relationship.toId,
        strength: relationship.strength,
        tension: relationship.tension,
      });
    }
  }
  return {
    ...directions,
    total: state.relationships.length,
    encounteredCount: sociallyEncountered.size,
    unencounteredIds: state.relationships.filter(({ id }) => !sociallyEncountered.has(id)).map(({ id }) => id),
    causallyActiveCount: causallyActive.size,
    inactiveIds: state.relationships.filter(({ id }) => !causallyActive.has(id)).map(({ id }) => id),
    saturated,
    strained,
    maxTension: Math.max(0, ...state.relationships.map(({ tension = 0 }) => tension)),
  };
}

function personalHistoryDiagnostics(state) {
  const meaningfulTypes = new Set([
    "encounter",
    "obligation",
    "obligation-created",
    "action-interrupted",
    "model-fallback",
    "reflection",
    "reflection-fallback",
  ]);
  return Object.fromEntries(state.residents.map((resident) => {
    const events = (state.events ?? []).filter((event) => (
      meaningfulTypes.has(event.type)
      && (event.actorId === resident.id || event.relatedActorId === resident.id)
    ));
    const counterparties = new Set(events.flatMap((event) => [event.actorId, event.relatedActorId]).filter((id) => id && id !== resident.id));
    return [resident.id, {
      name: resident.name,
      meaningfulEvents: events.length,
      activeDays: new Set(events.map(({ at }) => String(at).slice(0, 10))).size,
      counterparties: [...counterparties].sort(),
      eventTypes: eventCounts(events),
    }];
  }));
}

function placeParticipation(state) {
  const result = {};
  for (const location of state.locations) {
    const events = (state.events ?? []).filter((event) => event.type === "decision" && event.locationId === location.id);
    result[location.id] = {
      name: location.name,
      actions: events.length,
      residentCount: new Set(events.map(({ actorId }) => actorId).filter(Boolean)).size,
      residents: [...new Set(events.map(({ actorId }) => actorId).filter(Boolean))].sort(),
    };
  }
  return result;
}

function relationshipChanges(initial, final) {
  const initialById = new Map((initial.relationships ?? []).map((relationship) => [relationship.id, relationship]));
  const changes = (final.relationships ?? [])
    .map((relationship) => {
      const before = initialById.get(relationship.id);
      if (!before) return { ...relationship, from: null, to: relationship.strength, delta: relationship.strength };
      return {
        id: relationship.id,
        fromId: relationship.fromId,
        toId: relationship.toId,
        kind: relationship.kind,
        from: before.strength,
        to: relationship.strength,
        delta: relationship.strength - before.strength,
      };
    })
    .filter(({ delta }) => delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.id.localeCompare(right.id));

  return {
    changedCount: changes.length,
    totalDelta: changes.reduce((total, change) => total + change.delta, 0),
    biggestIncreases: changes.filter(({ delta }) => delta > 0).sort((left, right) => right.delta - left.delta).slice(0, 5),
    biggestDecreases: changes.filter(({ delta }) => delta < 0).sort((left, right) => left.delta - right.delta).slice(0, 5),
  };
}

function decisionsPerResident(state) {
  const actionEvents = (state.events ?? []).filter((event) => event.type === "decision" && event.actorId);
  return Object.fromEntries(state.residents.map((resident) => {
    const events = actionEvents.filter((event) => event.actorId === resident.id);
    const actionTypes = events.reduce((counts, event) => {
      increment(counts, event.action ?? "unknown");
      return counts;
    }, {});
    return [resident.id, {
      name: resident.name,
      plans: resident.planCount ?? resident.decisionCount ?? 0,
      actions: resident.actionCount ?? events.length,
      interruptedActions: resident.interruptedActionCount ?? 0,
      actionTypes,
      lastActionAt: resident.lastDecisionAt,
    }];
  }));
}

function obligationsSummary(state) {
  const obligations = state.obligations ?? [];
  const statusCounts = obligations.reduce((counts, obligation) => {
    increment(counts, obligation.status ?? "unknown");
    return counts;
  }, {});
  const generations = obligations.reduce((highest, obligation) => Math.max(highest, obligation.generation ?? 0), 0);
  const civic = obligations.filter(({ civicChainId }) => civicChainId);
  const civicByChain = civic.reduce((counts, obligation) => {
    increment(counts, obligation.civicChainId);
    return counts;
  }, {});
  return {
    total: obligations.length,
    created: state.stats.obligationCreatedCount ?? obligations.length,
    resolved: state.stats.obligationResolvedCount ?? 0,
    failed: state.stats.obligationFailedCount ?? statusCounts.broken ?? 0,
    fulfilled: statusCounts.fulfilled ?? 0,
    delayed: statusCounts.delayed ?? 0,
    broken: statusCounts.broken ?? 0,
    open: statusCounts.open ?? 0,
    highestGeneration: generations,
    statusCounts,
    civic: {
      total: civic.length,
      created: state.stats.civicObligationCreatedCount ?? civic.length,
      byChain: civicByChain,
      statusCounts: civic.reduce((counts, obligation) => {
        increment(counts, obligation.status ?? "unknown");
        return counts;
      }, {}),
    },
  };
}

function locationsSummary(state) {
  const activityByLocation = {};
  for (const event of state.events ?? []) {
    if (event.type !== "decision" || !event.locationId) continue;
    const location = activityByLocation[event.locationId] ?? { actions: 0, actionTypes: {} };
    location.actions += 1;
    increment(location.actionTypes, event.action ?? "unknown");
    activityByLocation[event.locationId] = location;
  }

  const occupancyAtEnd = Object.fromEntries(state.locations.map((location) => [location.id, {
    name: location.name,
    residents: state.residents
      .filter((resident) => resident.locationId === location.id)
      .map((resident) => resident.id),
  }]));
  return { activityByLocation, occupancyAtEnd };
}

function needsRanges(extremes, state) {
  const energy = state.residents.map(({ energy }) => energy);
  const hunger = state.residents.map(({ hunger }) => hunger);
  return {
    energy: { min: Math.min(extremes.energy.min, ...energy), max: Math.max(extremes.energy.max, ...energy) },
    hunger: { min: Math.min(extremes.hunger.min, ...hunger), max: Math.max(extremes.hunger.max, ...hunger) },
  };
}

function updateExtremes(extremes, state) {
  const ranges = needsRanges(extremes, state);
  extremes.energy = ranges.energy;
  extremes.hunger = ranges.hunger;
}

function invariantReport(initial, state) {
  const residentIds = state.residents.map(({ id }) => id);
  const locationIds = new Set(state.locations.map(({ id }) => id));
  const relationshipIds = new Set((state.relationships ?? []).map(({ id }) => id));
  const obligationIds = new Set((state.obligations ?? []).map(({ id }) => id));
  const obligationIdList = (state.obligations ?? []).map(({ id }) => id);
  const eventIds = (state.events ?? []).map(({ id }) => id);
  const residentIdSet = new Set(residentIds);
  const duplicateResidentIds = residentIds.filter((id, index) => residentIds.indexOf(id) !== index);
  const duplicateEventIds = eventIds.filter((id, index) => eventIds.indexOf(id) !== index);
  const duplicateObligationIds = obligationIdList.filter((id, index) => obligationIdList.indexOf(id) !== index);
  const invalidResidentLocations = state.residents
    .filter((resident) => !locationIds.has(resident.locationId))
    .map(({ id, locationId }) => ({ id, locationId }));
  const invalidRelationshipResidents = (state.relationships ?? [])
    .filter((relationship) => (
      !residentIdSet.has(relationship.fromId) || !residentIdSet.has(relationship.toId)
    ))
    .map(({ id, fromId, toId }) => ({ id, fromId, toId }));
  const invalidReflectionTargets = state.residents
    .filter((resident) => resident.reflection?.focusTargetId)
    .filter((resident) => !(state.relationships ?? []).some((relationship) => (
      (relationship.fromId === resident.id && relationship.toId === resident.reflection.focusTargetId)
      || (relationship.toId === resident.id && relationship.fromId === resident.reflection.focusTargetId)
    )))
    .map(({ id, reflection }) => ({ id, focusTargetId: reflection.focusTargetId }));
  const invalidObligationReferences = (state.obligations ?? [])
    .filter((obligation) => (
      !residentIdSet.has(obligation.ownerId)
      || !residentIdSet.has(obligation.counterpartyId)
      || !locationIds.has(obligation.destinationId)
    ))
    .map(({ id, ownerId, counterpartyId, destinationId }) => ({
      id,
      ownerId,
      counterpartyId,
      destinationId,
    }));
  const invalidCivicProgress = [];
  for (const [chainId, progress] of Object.entries(state.civicIncidents?.chains ?? {})) {
    if (progress.activeObligationId) {
      const active = state.obligations.find(({ id }) => id === progress.activeObligationId);
      if (!active || active.status !== "open" || active.civicChainId !== chainId) {
        invalidCivicProgress.push({ chainId, activeObligationId: progress.activeObligationId });
      }
    }
  }
  const duplicateQueueEntries = [];
  const queueEntriesDueAtEnd = [];
  const invalidQueueEntries = [];
  const queueOrderErrors = [];
  for (const resident of state.residents) {
    const ids = resident.actionQueue.map(({ id }) => id);
    let previousScheduledAt = null;
    for (const id of ids.filter((id, index) => ids.indexOf(id) !== index)) {
      duplicateQueueEntries.push({ residentId: resident.id, id });
    }
    for (const action of resident.actionQueue) {
      const scheduledAt = new Date(action.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        invalidQueueEntries.push({ residentId: resident.id, id: action.id, reason: "invalid scheduledAt" });
      } else {
        if (previousScheduledAt && scheduledAt < previousScheduledAt) {
          queueOrderErrors.push({ residentId: resident.id, id: action.id, scheduledAt: action.scheduledAt });
        }
        previousScheduledAt = scheduledAt;
        if (asDate(action.scheduledAt) <= asDate(state.now)) {
          queueEntriesDueAtEnd.push({ residentId: resident.id, id: action.id, scheduledAt: action.scheduledAt });
        }
      }
      if (!locationIds.has(action.intent?.locationId)) {
        invalidQueueEntries.push({
          residentId: resident.id,
          id: action.id,
          reason: "unknown action location",
          locationId: action.intent?.locationId,
        });
      }
      if (action.travelMinutes !== undefined
        && (!Number.isFinite(action.travelMinutes) || action.travelMinutes < 0)) {
        invalidQueueEntries.push({ residentId: resident.id, id: action.id, reason: "invalid travel minutes" });
      }
      if (action.serviceMinutes !== undefined
        && (!Number.isFinite(action.serviceMinutes) || action.serviceMinutes < 0)) {
        invalidQueueEntries.push({ residentId: resident.id, id: action.id, reason: "invalid service minutes" });
      }
    }
  }
  const overdueOpenObligations = (state.obligations ?? [])
    .filter((obligation) => obligation.status === "open" && obligation.dueAt && asDate(obligation.dueAt) < asDate(state.now))
    .map(({ id, dueAt }) => ({ id, dueAt }));
  const needsOutOfRange = state.residents
    .filter((resident) => resident.energy < 0 || resident.energy > 100 || resident.hunger < 0 || resident.hunger > 100)
    .map(({ id, energy, hunger }) => ({ id, energy, hunger }));
  const invalidEventActors = (state.events ?? [])
    .filter((event) => event.actorId && !residentIdSet.has(event.actorId))
    .map(({ id, actorId }) => ({ id, actorId }));
  const invalidEventReferences = [];
  for (const event of state.events ?? []) {
    for (const [field, ids, value] of [
      ["relatedActorId", residentIdSet, event.relatedActorId],
      ["locationId", locationIds, event.locationId],
      ["relationshipId", relationshipIds, event.relationshipId],
      ["obligationId", obligationIds, event.obligationId],
    ]) {
      if (value && !ids.has(value)) invalidEventReferences.push({ id: event.id, field, value });
    }
  }

  const recentActionEvents = (state.events ?? []).filter((event) => event.type === "decision" && event.actorId);
  const stuckResidents = [];
  for (const resident of state.residents) {
    const actions = recentActionEvents.filter((event) => event.actorId === resident.id).slice(-12);
    if (actions.length === 0) {
      stuckResidents.push({ id: resident.id, reason: "no actions recorded" });
    } else if (actions.length >= 8 && actions.every(({ action }) => action === "rest")) {
      stuckResidents.push({ id: resident.id, reason: "rest loop" });
    }
  }

  const checks = {
    duplicateResidentIds,
    duplicateEventIds,
    duplicateObligationIds,
    invalidResidentLocations,
    invalidRelationshipResidents,
    invalidReflectionTargets,
    invalidObligationReferences,
    invalidCivicProgress,
    invalidEventActors,
    invalidEventReferences,
    duplicateQueueEntries,
    invalidQueueEntries,
    queueOrderErrors,
    queueEntriesDueAtEnd,
    overdueOpenObligations,
    needsOutOfRange,
    stuckResidents,
    eventCountMismatch: (state.stats.eventCount ?? 0)
      !== (initial.stats.eventCount ?? 0) + (state.events.length - initial.events.length),
  };
  return {
    ...checks,
    healthy: Object.values(checks).every((value) => value === false || (Array.isArray(value) && value.length === 0)),
  };
}

export function summarizeScenario(initial, state, extremes) {
  const ranges = needsRanges(extremes, state);
  const invariants = invariantReport(initial, state);
  return {
    day: state.day,
    now: state.now,
    simulatedDays: (asDate(state.now).getTime() - asDate(state.startedAt).getTime()) / (DAY_MINUTES * MINUTE_MS),
    eventCounts: eventCounts(state.events ?? []),
    decisionsPerResident: decisionsPerResident(state),
    relationshipChanges: relationshipChanges(initial, state),
    obligations: obligationsSummary(state),
    locations: locationsSummary(state),
    longHorizon: {
      eventDiversity: eventDiversity(state.events ?? []),
      dailyPatterns: dailyPatternDiagnostics(state),
      relationshipDynamics: relationshipDynamics(initial, state),
      personalHistories: personalHistoryDiagnostics(state),
      placeParticipation: placeParticipation(state),
    },
    model: {
      calls: state.stats.modelCalls ?? 0,
      attempts: state.stats.modelAttempts ?? 0,
      fallbacks: state.stats.modelFallbacks ?? 0,
      costSkips: state.stats.modelCostSkips ?? 0,
      promptTokens: state.stats.modelPromptTokens ?? 0,
      completionTokens: state.stats.modelCompletionTokens ?? 0,
      promptCacheHitTokens: state.stats.modelPromptCacheHitTokens ?? 0,
      promptCacheMissTokens: state.stats.modelPromptCacheMissTokens ?? 0,
    },
    reflections: {
      count: state.stats.reflectionCount ?? 0,
      modelCalls: state.stats.reflectionModelCalls ?? 0,
      attempts: state.stats.reflectionAttempts ?? 0,
      fallbacks: state.stats.reflectionFallbacks ?? 0,
      promptTokens: state.stats.reflectionPromptTokens ?? 0,
      completionTokens: state.stats.reflectionCompletionTokens ?? 0,
      promptCacheHitTokens: state.stats.reflectionPromptCacheHitTokens ?? 0,
      promptCacheMissTokens: state.stats.reflectionPromptCacheMissTokens ?? 0,
    },
    ranges,
    stats: {
      tickCount: state.stats.tickCount,
      plans: state.stats.planCount,
      actions: state.stats.actionCount,
      interruptedActions: state.stats.interruptedActionCount,
      conflictedPlans: state.stats.conflictedPlanCount ?? 0,
      encounters: state.stats.encounterCount,
    },
    invariants,
    healthy: invariants.healthy,
  };
}

function normalizeCheckpoints(checkpoints, days) {
  if (checkpoints !== undefined && !Array.isArray(checkpoints)) {
    throw new TypeError("checkpoints must be a non-empty array");
  }
  const requested = checkpoints ?? DEFAULT_CHECKPOINTS.filter((day) => day <= days);
  const fallback = requested.length > 0 ? requested : [days];
  if (fallback.length === 0) {
    throw new TypeError("checkpoints must be a non-empty array");
  }
  const values = [...new Set(fallback)].sort((left, right) => left - right);
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > days)) {
    throw new RangeError(`checkpoints must be whole simulated days between 1 and ${days}`);
  }
  return values;
}

function validateScenarioOptions({ days, tickMinutes, decisionAdapter, prepareState }) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_SCENARIO_DAYS) {
    throw new RangeError(`days must be an integer between 1 and ${MAX_SCENARIO_DAYS}`);
  }
  if (!Number.isInteger(tickMinutes) || tickMinutes < 1 || tickMinutes > DAY_MINUTES || DAY_MINUTES % tickMinutes !== 0) {
    throw new RangeError("tickMinutes must divide a simulated day and be between 1 and 1440");
  }
  if (decisionAdapter !== undefined && typeof decisionAdapter !== "function") {
    throw new TypeError("decisionAdapter must be a function");
  }
  if (prepareState !== null && prepareState !== undefined && typeof prepareState !== "function") {
    throw new TypeError("prepareState must be a function");
  }
}

export async function createScenarioRun({
  days = 90,
  checkpoints,
  seed = "calder-station-long-horizon",
  startTime = DEFAULT_START_TIME,
  tickMinutes = DAY_MINUTES,
  seedData = townSeed,
  prepareState = null,
} = {}) {
  validateScenarioOptions({ days, tickMinutes, prepareState });

  const checkpointDays = normalizeCheckpoints(checkpoints, days);
  let state = createInitialTown({ seed, startTime, seedData, environment: "staging" });
  if (prepareState) state = await prepareState(state) ?? state;
  if (!state || !Array.isArray(state.residents) || !Array.isArray(state.locations)) {
    throw new TypeError("prepareState must return a town state");
  }
  state.mode = "staging-scenario";
  state.persistence = "scenario-memory";
  const initial = clone(state);
  const extremes = {
    energy: {
      min: Math.min(...state.residents.map(({ energy }) => energy)),
      max: Math.max(...state.residents.map(({ energy }) => energy)),
    },
    hunger: {
      min: Math.min(...state.residents.map(({ hunger }) => hunger)),
      max: Math.max(...state.residents.map(({ hunger }) => hunger)),
    },
  };

  return {
    kind: "calder-station-scenario-run",
    seed,
    seedRevision: state.seedRevision,
    startTime: asDate(startTime).toISOString(),
    days,
    tickMinutes,
    checkpointDays,
    reports: {},
    completedDays: 0,
    state,
    initial,
    extremes,
  };
}

export async function advanceScenarioRun(run, {
  throughDay = run?.days,
  decisionAdapter = scriptedObligationPlan,
  reflectionAdapter = null,
  reflectionPolicy = null,
  wallClock = new Date(),
} = {}) {
  if (!run || typeof run !== "object") throw new TypeError("scenario run is required");
  validateScenarioOptions({
    days: run.days,
    tickMinutes: run.tickMinutes,
    decisionAdapter,
    prepareState: null,
  });
  if (reflectionAdapter !== null && typeof reflectionAdapter !== "function") {
    throw new TypeError("reflectionAdapter must be a function or null");
  }
  if (!Number.isInteger(run.completedDays) || run.completedDays < 0 || run.completedDays > run.days) {
    throw new RangeError("scenario run has an invalid completed day");
  }
  if (!Number.isInteger(throughDay) || throughDay < run.completedDays || throughDay > run.days) {
    throw new RangeError(`throughDay must be a whole day between ${run.completedDays} and ${run.days}`);
  }

  let state = run.state;
  const extremes = run.extremes;
  const reports = { ...(run.reports ?? {}) };
  let checkpointIndex = (run.checkpointDays ?? []).findIndex((day) => !reports[String(day)]);
  if (checkpointIndex < 0) checkpointIndex = (run.checkpointDays ?? []).length;
  const ticks = (throughDay - run.completedDays) * DAY_MINUTES / run.tickMinutes;

  for (let tick = 0; tick < ticks; tick += 1) {
    state = await advanceTown(state, {
      minutes: run.tickMinutes,
      decisionAdapter,
      reflectionAdapter,
      reflectionPolicy,
      wallClock,
    });
    updateExtremes(extremes, state);
    const completedDays = run.completedDays + ((tick + 1) * run.tickMinutes) / DAY_MINUTES;
    while (checkpointIndex < run.checkpointDays.length && run.checkpointDays[checkpointIndex] <= completedDays) {
      const day = run.checkpointDays[checkpointIndex];
      reports[String(day)] = summarizeScenario(run.initial, state, extremes);
      checkpointIndex += 1;
    }
  }

  return {
    ...run,
    state,
    reports,
    completedDays: throughDay,
    extremes,
  };
}

export function scenarioRunResult(run) {
  if (!run || typeof run !== "object") throw new TypeError("scenario run is required");
  return {
    kind: "calder-station-scenario",
    seed: run.seed,
    seedRevision: run.seedRevision,
    startTime: run.startTime,
    days: run.days,
    tickMinutes: run.tickMinutes,
    checkpoints: run.reports,
    final: summarizeScenario(run.initial, run.state, run.extremes),
    state: run.state,
  };
}

export async function runScenario({
  days = 90,
  checkpoints,
  seed = "calder-station-long-horizon",
  startTime = DEFAULT_START_TIME,
  tickMinutes = DAY_MINUTES,
  seedData = townSeed,
  decisionAdapter = scriptedObligationPlan,
  reflectionAdapter = null,
  reflectionPolicy = null,
  wallClock = new Date(),
  prepareState = null,
} = {}) {
  const run = await createScenarioRun({
    days,
    checkpoints,
    seed,
    startTime,
    tickMinutes,
    seedData,
    prepareState,
  });
  const completed = await advanceScenarioRun(run, {
    throughDay: days,
    decisionAdapter,
    reflectionAdapter,
    reflectionPolicy,
    wallClock,
  });
  return scenarioRunResult(completed);
}

export { DEFAULT_CHECKPOINTS };
