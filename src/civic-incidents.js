import { materializeObligation } from "./obligations.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const INCIDENT_VERSION = 1;
const FOLLOW_UP_DELAY_MS = 24 * HOUR_MS;
const RETRY_DELAY_MS = 48 * HOUR_MS;
const BROKEN_COOLDOWN_MS = 10 * DAY_MS;
const COMPLETED_COOLDOWN_MS = 12 * DAY_MS;
const MAX_OPEN_PER_OWNER = 2;

export const CIVIC_CHAINS = Object.freeze([
  Object.freeze({
    id: "care-and-records",
    firstAfterDays: 2,
    steps: Object.freeze([
      Object.freeze({ id: "clinic-repair", ownerId: "otis", counterpartyId: "nell", destinationId: "clinic", requiredAction: "work", title: "Nell Ward's clinic repair", description: "Nell needs Otis to secure the clinic's loose window before the next wet night." }),
      Object.freeze({ id: "school-visit", ownerId: "nell", counterpartyId: "june", destinationId: "schoolhouse", requiredAction: "observe", title: "June Collins's school visit", description: "June asked Nell to check on a child after the clinic repair freed an afternoon." }),
      Object.freeze({ id: "lesson-record", ownerId: "june", counterpartyId: "vey", destinationId: "town-hall", requiredAction: "deliver", title: "Jamie Allen's lesson record", description: "June must carry the revised lesson record to Calder Hall after the school visit." }),
    ]),
  }),
  Object.freeze({
    id: "flour-and-table",
    firstAfterDays: 4,
    steps: Object.freeze([
      Object.freeze({ id: "flour-parcel", ownerId: "edda", counterpartyId: "mara", destinationId: "bakery", requiredAction: "deliver", title: "Mara Konstantinidis's flour parcel", description: "Erin promised a fresh flour parcel after Mara found the last bin running low." }),
      Object.freeze({ id: "bread-basket", ownerId: "mara", counterpartyId: "lio", destinationId: "inn", requiredAction: "deliver", title: "Leo Price's bread basket", description: "The flour became a bread order for Leo's evening table at the inn." }),
      Object.freeze({ id: "inn-account", ownerId: "lio", counterpartyId: "corin", destinationId: "inn", requiredAction: "work", title: "Corin Price's kitchen account", description: "Leo must balance the kitchen account after the bread order changed the week's stores." }),
    ]),
  }),
  Object.freeze({
    id: "dye-and-repair",
    firstAfterDays: 6,
    steps: Object.freeze([
      Object.freeze({ id: "dye-bundle", ownerId: "pella", counterpartyId: "tamsin", destinationId: "weavers-loft", requiredAction: "deliver", title: "Tamsin Moore's dye bundle", description: "Paula promised Tamsin a bundle cut from the dye garden." }),
      Object.freeze({ id: "loom-repair", ownerId: "bram", counterpartyId: "tamsin", destinationId: "weavers-loft", requiredAction: "work", title: "Tamsin Moore's loom repair", description: "The new dye exposed a worn loom brace that Tamsin asked Ben to mend." }),
      Object.freeze({ id: "workshop-parts", ownerId: "otis", counterpartyId: "bram", destinationId: "workshop", requiredAction: "deliver", title: "Ben Carter's workshop parts", description: "Ben needs Otis to set aside the fittings used in the loom repair." }),
    ]),
  }),
  Object.freeze({
    id: "night-route",
    firstAfterDays: 3,
    steps: Object.freeze([
      Object.freeze({ id: "route-report", ownerId: "sal", counterpartyId: "amos", destinationId: "square", requiredAction: "observe", title: "Amos Foster's route report", description: "Amos asked Sal to check the square before choosing between the report and the clerk's next detour." }),
      Object.freeze({ id: "closing-round", ownerId: "amos", counterpartyId: "corin", destinationId: "inn", requiredAction: "observe", title: "Corin Price's closing round", description: "The route report left Amos responsible for checking the inn's late closing." }),
    ]),
  }),
]);

function asDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid civic incident date: ${String(value)}`);
  return date;
}

function chainDefinition(id) {
  return CIVIC_CHAINS.find((chain) => chain.id === id);
}

export function normalizeCivicIncidents(state) {
  const startedAt = asDate(state.startedAt ?? state.now);
  state.civicIncidents ??= { version: INCIDENT_VERSION, chains: {} };
  state.civicIncidents.version = INCIDENT_VERSION;
  state.civicIncidents.chains ??= {};
  for (const chain of CIVIC_CHAINS) {
    state.civicIncidents.chains[chain.id] ??= {
      cycle: 0,
      step: 0,
      attempt: 0,
      nextAt: new Date(startedAt.getTime() + chain.firstAfterDays * DAY_MS).toISOString(),
      activeObligationId: null,
      previousObligationId: null,
      lastOutcome: null,
    };
  }
  return state.civicIncidents;
}

function ownerOpenCount(state, ownerId) {
  return (state.obligations ?? []).filter((obligation) => obligation.ownerId === ownerId && obligation.status === "open").length;
}

export function createDueCivicObligations(state, at) {
  const now = asDate(at);
  const incidentState = normalizeCivicIncidents(state);
  const created = [];

  for (const chain of CIVIC_CHAINS) {
    const progress = incidentState.chains[chain.id];
    if (!progress.nextAt || asDate(progress.nextAt) > now || progress.activeObligationId) continue;
    const step = chain.steps[progress.step];
    if (!step) continue;
    if (ownerOpenCount(state, step.ownerId) >= MAX_OPEN_PER_OWNER) {
      progress.nextAt = new Date(now.getTime() + 12 * HOUR_MS).toISOString();
      continue;
    }
    const id = `civic-${chain.id}-${progress.cycle}-${progress.step}-${progress.attempt}`;
    const obligation = materializeObligation({
      ...step,
      id,
      kind: "civic-request",
      dueAfterMinutes: 48 * 60,
      renewable: false,
      seriesId: `civic-${chain.id}`,
      generation: progress.cycle,
      parentObligationId: progress.previousObligationId,
      civicChainId: chain.id,
      civicStep: progress.step,
      civicAttempt: progress.attempt,
    }, now);
    state.obligations.push(obligation);
    progress.activeObligationId = obligation.id;
    progress.nextAt = null;
    created.push(obligation);
  }
  return created;
}

export function recordCivicOutcome(state, obligation, at) {
  if (!obligation?.civicChainId) return false;
  const incidentState = normalizeCivicIncidents(state);
  const progress = incidentState.chains[obligation.civicChainId];
  const chain = chainDefinition(obligation.civicChainId);
  if (!progress || !chain || progress.activeObligationId !== obligation.id) return false;

  const resolvedAt = asDate(at);
  progress.activeObligationId = null;
  progress.previousObligationId = obligation.id;
  progress.lastOutcome = obligation.status;

  if (obligation.status === "fulfilled") {
    progress.attempt = 0;
    if (progress.step + 1 < chain.steps.length) {
      progress.step += 1;
      progress.nextAt = new Date(resolvedAt.getTime() + FOLLOW_UP_DELAY_MS).toISOString();
    } else {
      progress.cycle += 1;
      progress.step = 0;
      progress.nextAt = new Date(resolvedAt.getTime() + COMPLETED_COOLDOWN_MS).toISOString();
    }
  } else if (obligation.status === "delayed") {
    progress.attempt += 1;
    progress.nextAt = new Date(resolvedAt.getTime() + RETRY_DELAY_MS).toISOString();
  } else if (obligation.status === "broken") {
    progress.cycle += 1;
    progress.step = 0;
    progress.attempt = 0;
    progress.nextAt = new Date(resolvedAt.getTime() + BROKEN_COOLDOWN_MS).toISOString();
  }
  return true;
}
