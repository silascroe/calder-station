import { spreadDailyDecisionTimes } from "./scheduler.js";
import { TOWN_SEED_REVISION, townSeed } from "./demo-data.js";
import { normalizeDailyPlan, scriptedDailyPlan } from "./daily-plans.js";
import { resolveSocialIntentions } from "./social.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MINUTES = 60;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const DEFAULT_START_TIME = "2026-08-31T00:00:00.000Z";
export const DEFAULT_TICK_MINUTES = HOUR_MINUTES;
export const DEFAULT_PREVIEW_TICKS = 24;
export const MAX_PREVIEW_TICKS = 48;

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
  const location = state.locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new RangeError(`Unknown location: ${locationId}`);
  return location;
}

function residentIds(state) {
  return state.residents.map(({ id }) => id);
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

function appendEvent(state, {
  at,
  actorId = null,
  relatedActorId = null,
  locationId = null,
  relationshipId = null,
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

function resolveDecision(state, resident, intent, decisionAt, source = "scripted") {
  const allowedActions = new Set(["work", "eat", "rest", "deliver", "observe"]);
  if (!intent || !allowedActions.has(intent.action)) {
    throw new RangeError(`Unsupported scripted action: ${intent?.action}`);
  }

  const target = locationFor(state, intent.locationId || resident.locationId);
  const previousLocation = locationFor(state, resident.locationId);

  if (previousLocation.id !== target.id) {
    updateLocation(resident, target);
    appendEvent(state, {
      at: decisionAt,
      actorId: resident.id,
      locationId: target.id,
      type: "movement",
      text: `walked from ${previousLocation.name} to ${target.name}`,
      source,
    });
  }

  if (intent.action === "work") {
    resident.energy = clamp(resident.energy - 8);
  } else if (intent.action === "eat") {
    resident.hunger = clamp(resident.hunger - 38);
    resident.energy = clamp(resident.energy + 3);
  } else if (intent.action === "rest") {
    resident.energy = clamp(resident.energy + 12);
  } else if (intent.action === "deliver") {
    resident.energy = clamp(resident.energy - 6);
  } else if (intent.action === "observe") {
    resident.energy = clamp(resident.energy - 2);
  }

  resident.status = intent.status;
  resident.mood = intent.mood;
  resident.lastAction = intent.action;
  resident.lastDecisionAt = asDate(decisionAt).toISOString();
  resident.decisionCount += 1;
  resident.nextDecisionAt = nextRoutineDecision(state, resident.id, decisionAt).toISOString();

  const actionText = {
    work: `started work at ${target.name}`,
    eat: `stopped to eat at ${target.name}`,
    rest: `settled in to rest at ${target.name}`,
    deliver: `took a delivery route through ${target.name}`,
    observe: `watched ${target.name} for anything unusual`,
  }[intent.action];

  appendEvent(state, {
    at: decisionAt,
    actorId: resident.id,
    locationId: target.id,
    type: "decision",
    text: actionText,
    source,
    reason: intent.reason,
  });
}

function simulationDay(startedAt, now) {
  return Math.floor((asDate(now).getTime() - asDate(startedAt).getTime()) / DAY_MS) + 1;
}

export function createInitialTown({
  seed = "rookwood-day-one",
  startTime = DEFAULT_START_TIME,
  seedData = townSeed,
} = {}) {
  if (!seedData || !Array.isArray(seedData.locations) || !Array.isArray(seedData.residents)) {
    throw new TypeError("seedData must include locations and residents arrays");
  }

  const startedAt = asDate(startTime);
  const ids = seedData.residents.map(({ id }) => id);
  const state = {
    id: seedData.id,
    name: seedData.name,
    mode: "scripted-simulation-preview",
    persistence: "ephemeral",
    seed,
    seedRevision: TOWN_SEED_REVISION,
    startedAt: startedAt.toISOString(),
    now: startedAt.toISOString(),
    day: 1,
    clock: formatClock(startedAt),
    weather: seedData.weather,
    summary: "A replayable first-day simulation driven by ordinary game-AI rules.",
    locations: seedData.locations.map((location) => ({ ...location })),
    residents: [],
    relationships: (seedData.relationships ?? []).map((relationship) => ({ ...relationship })),
    events: [],
    stats: {
      tickCount: 0,
      decisionCount: 0,
      modelCalls: 0,
      eventCount: 0,
      planCount: 0,
      encounterCount: 0,
    },
  };

  // The seed is recorded for replay identity in this slice. Stochastic
  // variation is intentionally deferred until the deterministic rules are
  // durable enough to test against.

  state.residents = seedData.residents.map((residentSeed) => {
    const location = locationFor(state, residentSeed.initialLocationId);
    const resident = {
      ...residentSeed,
      ...(residentSeed.routine ? { routine: { ...residentSeed.routine } } : {}),
      locationId: location.id,
      location: location.name,
      x: location.x,
      y: location.y,
      status: "Asleep at home",
      decisionCount: 0,
      lastAction: "rest",
      lastDecisionAt: null,
      nextDecisionAt: null,
      dailyPlan: null,
      lastEncounterAt: null,
      lastEncounterWithId: null,
      socialCount: 0,
    };
    resident.nextDecisionAt = nextRoutineDecision(state, resident.id, startedAt, ids).toISOString();
    return resident;
  });

  appendEvent(state, {
    at: startedAt,
    type: "system",
    text: `${seedData.name}'s first day began`,
    source: "simulation",
  });

  return state;
}

export function advanceTown(state, {
  minutes = DEFAULT_TICK_MINUTES,
  decisionAdapter = scriptedDailyPlan,
} = {}) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * HOUR_MINUTES) {
    throw new RangeError("minutes must be an integer between 1 and 1440");
  }
  if (typeof decisionAdapter !== "function") {
    throw new TypeError("decisionAdapter must be a function");
  }

  const next = cloneTown(state);
  const from = asDate(next.now);
  const to = new Date(from.getTime() + minutes * MINUTE_MS);
  const dueResidents = next.residents
    .filter((resident) => resident.nextDecisionAt && asDate(resident.nextDecisionAt) <= to)
    .sort((left, right) => {
      const atDifference = asDate(left.nextDecisionAt) - asDate(right.nextDecisionAt);
      return atDifference || left.id.localeCompare(right.id);
    });

  let cursor = from;
  for (const resident of dueResidents) {
    const decisionAt = asDate(resident.nextDecisionAt);
    const effectiveDecisionAt = decisionAt < cursor ? cursor : decisionAt;
    applyNeeds(next, (effectiveDecisionAt.getTime() - cursor.getTime()) / MINUTE_MS);

    const rawPlan = decisionAdapter({
      town: cloneTown(next),
      resident: { ...resident },
      now: effectiveDecisionAt,
    });
    const plan = normalizeDailyPlan(rawPlan, {
      town: next,
      resident,
      now: effectiveDecisionAt,
    });
    const action = plan.actions[0];
    resident.dailyPlan = {
      version: plan.version,
      day: plan.day,
      source: plan.source,
      priorities: [...plan.priorities],
      action: action.action,
      locationId: action.locationId,
      reason: action.reason,
      actionCount: plan.actions.length,
      socialIntentions: plan.socialIntentions.map((intention) => ({ ...intention })),
    };
    next.stats.planCount = (next.stats.planCount ?? 0) + 1;
    if (plan.source === "model") next.stats.modelCalls = (next.stats.modelCalls ?? 0) + 1;
    resolveDecision(next, resident, action, effectiveDecisionAt, plan.source);

    const encounters = resolveSocialIntentions(next, resident, plan, effectiveDecisionAt);
    for (const encounter of encounters) {
      appendEvent(next, {
        at: effectiveDecisionAt,
        actorId: encounter.actorId,
        relatedActorId: encounter.targetId,
        locationId: encounter.locationId,
        relationshipId: encounter.relationshipId,
        type: encounter.type,
        text: encounter.text,
        source: plan.source,
        reason: encounter.reason,
      });
      next.stats.encounterCount = (next.stats.encounterCount ?? 0) + 1;
    }
    next.stats.decisionCount += 1;
    cursor = effectiveDecisionAt;
  }

  applyNeeds(next, (to.getTime() - cursor.getTime()) / MINUTE_MS);
  next.now = to.toISOString();
  next.day = simulationDay(next.startedAt, to);
  next.clock = formatClock(to);
  next.stats.tickCount += 1;
  return next;
}

function residentFromSeed(state, residentSeed, scheduledAfter, ids) {
  const location = locationFor(state, residentSeed.initialLocationId);
  const resident = {
    ...residentSeed,
    ...(residentSeed.routine ? { routine: { ...residentSeed.routine } } : {}),
    locationId: location.id,
    location: location.name,
    x: location.x,
    y: location.y,
    status: "Settling into town",
    decisionCount: 0,
    lastAction: "rest",
    lastDecisionAt: null,
    nextDecisionAt: null,
    dailyPlan: null,
    lastEncounterAt: null,
    lastEncounterWithId: null,
    socialCount: 0,
  };
  resident.nextDecisionAt = nextRoutineDecision(state, resident.id, scheduledAfter, ids).toISOString();
  return resident;
}

/**
 * Idempotently brings a persisted projection up to the current authored seed
 * without replacing the history or evolved state of existing residents.
 */
export function reconcileTownWithSeed(state, { seedData = townSeed } = {}) {
  const next = cloneTown(state);
  let metadataChanged = next.seedRevision !== TOWN_SEED_REVISION;
  next.events ??= [];
  next.stats ??= {
    tickCount: 0,
    decisionCount: 0,
    modelCalls: 0,
    eventCount: 0,
    planCount: 0,
    encounterCount: 0,
  };
  next.stats.eventCount ??= next.events.length;
  if (!("planCount" in next.stats) || !("encounterCount" in next.stats)) metadataChanged = true;
  next.stats.planCount ??= next.stats.decisionCount ?? 0;
  next.stats.encounterCount ??= 0;

  const changes = { locations: 0, residents: 0, relationships: 0 };
  const locationIds = new Set(next.locations.map(({ id }) => id));
  for (const location of seedData.locations) {
    if (locationIds.has(location.id)) continue;
    next.locations.push({ ...location });
    locationIds.add(location.id);
    changes.locations += 1;
  }

  const residentIds = new Set(next.residents.map(({ id }) => id));
  for (const resident of next.residents) {
    if (!("dailyPlan" in resident) || !("lastEncounterAt" in resident) || !("lastEncounterWithId" in resident) || !("socialCount" in resident)) {
      metadataChanged = true;
    }
    resident.dailyPlan ??= null;
    resident.lastEncounterAt ??= null;
    resident.lastEncounterWithId ??= null;
    resident.socialCount ??= 0;
  }
  const allResidentIds = seedData.residents.map(({ id }) => id);
  for (const residentSeed of seedData.residents) {
    if (residentIds.has(residentSeed.id)) continue;
    next.residents.push(residentFromSeed(next, residentSeed, next.now, allResidentIds));
    residentIds.add(residentSeed.id);
    changes.residents += 1;
  }

  const relationshipIds = new Set((next.relationships ?? []).map(({ id }) => id));
  next.relationships ??= [];
  for (const relationship of seedData.relationships ?? []) {
    if (relationshipIds.has(relationship.id)) continue;
    next.relationships.push({ ...relationship });
    relationshipIds.add(relationship.id);
    changes.relationships += 1;
  }

  next.seedRevision = TOWN_SEED_REVISION;
  const changed = Object.values(changes).some((count) => count > 0);
  if (changed) {
    const additions = [];
    if (changes.residents) additions.push(`${changes.residents} residents`);
    if (changes.locations) additions.push(`${changes.locations} places`);
    if (changes.relationships) additions.push(`${changes.relationships} relationships`);
    appendEvent(next, {
      at: next.now,
      type: "system",
      source: "migration",
      text: `the town register added ${additions.join(" and ")}`,
    });
  }

  return { state: next, changed, needsPersist: changed || metadataChanged, changes };
}

export function runPreview({
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
    state = advanceTown(state, { minutes: tickMinutes });
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
