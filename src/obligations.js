import {
  MAX_PLAN_ACTIONS,
  OBLIGATION_CHOICES,
  scriptedDailyPlan,
} from "./daily-plans.js";
import { applyCommitmentOutcome } from "./relationship-dynamics.js";

const MINUTE_MS = 60 * 1000;

export const RENEWAL_COOLDOWN_MINUTES = 6 * 60;
// Keep a renewal chain bounded, while allowing a single commitment series to
// remain causally relevant throughout the 90-day staging horizon.
export const MAX_RENEWABLE_GENERATIONS = 90;
export const MAX_OPEN_OBLIGATIONS = 6;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return date;
}

function relationshipBetween(state, firstId, secondId) {
  return (state.relationships ?? []).find((relationship) => (
    (relationship.fromId === firstId && relationship.toId === secondId)
    || (relationship.fromId === secondId && relationship.toId === firstId)
  ));
}

function residentName(state, id, fallback = id) {
  return state.residents.find(({ id: residentId }) => residentId === id)?.name ?? fallback;
}

export function materializeObligation(seed, startedAt) {
  const createdAt = asDate(seed.createdAt ?? startedAt);
  const dueAt = seed.dueAt
    ? asDate(seed.dueAt)
    : new Date(createdAt.getTime() + Number(seed.dueAfterMinutes ?? 0) * MINUTE_MS);
  return {
    ...seed,
    createdAt: createdAt.toISOString(),
    dueAt: dueAt.toISOString(),
    status: seed.status ?? "open",
    resolvedAt: seed.resolvedAt ?? null,
    resolution: seed.resolution ?? null,
    resolutionNote: seed.resolutionNote ?? null,
    renewable: seed.renewable === true,
    seriesId: seed.seriesId ?? seed.id,
    generation: Number.isInteger(seed.generation) && seed.generation >= 0 ? seed.generation : 0,
    parentObligationId: seed.parentObligationId ?? null,
    requiredAction: seed.requiredAction ?? (seed.kind === "delivery" ? "deliver" : "observe"),
  };
}

export function openObligationFor(state, residentId) {
  return (state.obligations ?? [])
    .filter((obligation) => obligation.ownerId === residentId && obligation.status === "open")
    .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)) || left.id.localeCompare(right.id))[0];
}

/**
 * Scripted fallback for the model experiment. It makes a concrete choice so
 * the town remains playable even when DeepSeek is unavailable.
 */
export function scriptedObligationPlan({ town, resident, now } = {}) {
  const base = scriptedDailyPlan({ town, resident, now });
  const obligation = openObligationFor(town, resident.id);
  if (!obligation) return base;

  const canTakeDirectRoute = resident.energy > 35 && resident.hunger < 94;
  const requiredAction = obligation.requiredAction ?? "deliver";
  const action = canTakeDirectRoute
    ? {
      ...base.actions[0],
      action: requiredAction,
      locationId: obligation.destinationId,
      offsetMinutes: 0,
      reason: `${obligation.title} is due soon`,
      status: requiredAction === "work" ? "Taking on the promised work" : "Taking the direct route",
      mood: "Determined",
    }
    : {
      ...base.actions[0],
      action: "observe",
      locationId: resident.locationId,
      offsetMinutes: 0,
      reason: "energy is too low to make the promised detour",
      status: "Reporting a delay",
      mood: "Uneasy",
    };

  return {
    ...base,
    priorities: [
      canTakeDirectRoute ? `fulfill ${obligation.title}` : `report a delay on ${obligation.title}`,
      "keep the regular route from unraveling",
    ],
    // Keep the commitment from erasing the resident's ordinary meals and
    // return home. The obligation owns the immediate slot; routine actions
    // still get the remaining bounded queue capacity.
    actions: [action, ...base.actions.slice(1, MAX_PLAN_ACTIONS)],
    socialIntentions: [],
    obligationDecision: {
      obligationId: obligation.id,
      choice: canTakeDirectRoute ? "fulfill" : "report_delay",
      note: canTakeDirectRoute ? "the promised work is still possible" : "the detour would risk the rest of the day",
    },
  };
}

/** Apply the consequence of a validated obligation choice. */
export function resolveObligationDecision(state, resident, plan, at) {
  if (!plan.obligationDecision) return null;

  const decision = plan.obligationDecision;
  if (!OBLIGATION_CHOICES.includes(decision.choice)) {
    throw new RangeError(`Unsupported obligation choice: ${decision.choice}`);
  }
  const obligation = (state.obligations ?? []).find(({ id }) => id === decision.obligationId);
  if (!obligation || obligation.status !== "open" || obligation.ownerId !== resident.id) {
    throw new RangeError("Obligation is no longer open for this resident");
  }

  const counterparty = state.residents.find(({ id }) => id === obligation.counterpartyId);
  const relationship = relationshipBetween(state, resident.id, obligation.counterpartyId);
  if (!counterparty || !relationship) {
    throw new RangeError("Obligation has no valid counterparty relationship");
  }

  const resolvedAt = asDate(at).toISOString();
  const fulfilling = decision.choice === "fulfill";
  obligation.status = fulfilling ? "fulfilled" : "delayed";
  obligation.resolution = decision.choice;
  obligation.resolutionNote = decision.note ?? null;
  obligation.resolvedAt = resolvedAt;
  const relationshipChange = applyCommitmentOutcome(
    relationship,
    fulfilling ? "fulfilled" : "delayed",
    resolvedAt,
  );

  const destination = state.locations.find(({ id }) => id === obligation.destinationId);
  const actionText = {
    deliver: `delivered ${obligation.title} to ${destination?.name ?? obligation.destinationId}`,
    work: `completed ${obligation.title} at ${destination?.name ?? obligation.destinationId}`,
    observe: `completed the promised check for ${obligation.title} at ${destination?.name ?? obligation.destinationId}`,
  }[obligation.requiredAction ?? "deliver"];
  return {
    obligationId: obligation.id,
    actorId: resident.id,
    relatedActorId: counterparty.id,
    locationId: fulfilling ? obligation.destinationId : resident.locationId,
    relationshipId: relationship.id,
    relationshipDelta: relationshipChange.strengthDelta,
    tensionDelta: relationshipChange.tensionDelta,
    type: "obligation",
    text: fulfilling
      ? actionText
      : `reported a delay on ${obligation.title}`,
    reason: decision.note ?? null,
  };
}

/** Mark open commitments missed after their due time and apply the penalty. */
export function expireOverdueObligations(state, at) {
  const now = asDate(at);
  const outcomes = [];

  for (const obligation of state.obligations ?? []) {
    if (obligation.status !== "open" || !obligation.dueAt || asDate(obligation.dueAt) >= now) continue;

    obligation.status = "broken";
    obligation.resolution = "broken";
    obligation.resolutionNote = "the due time passed without a decision";
    obligation.resolvedAt = now.toISOString();

    const relationship = relationshipBetween(state, obligation.ownerId, obligation.counterpartyId);
    const relationshipChange = relationship
      ? applyCommitmentOutcome(relationship, "broken", now)
      : null;

    outcomes.push({
      obligationId: obligation.id,
      actorId: obligation.ownerId,
      relatedActorId: obligation.counterpartyId,
      locationId: obligation.destinationId,
      relationshipId: relationship?.id ?? null,
      relationshipDelta: relationshipChange?.strengthDelta ?? 0,
      tensionDelta: relationshipChange?.tensionDelta ?? 0,
      type: "obligation",
      text: `missed ${obligation.title}`,
      reason: obligation.resolutionNote,
    });
  }

  return outcomes;
}

function renewalCandidate(state, resolved, at) {
  if (!resolved.renewable || resolved.status === "open" || !resolved.resolvedAt) return null;
  if (resolved.generation >= MAX_RENEWABLE_GENERATIONS) return null;
  if ((state.obligations ?? []).some(({ parentObligationId }) => parentObligationId === resolved.id)) return null;
  if ((state.obligations ?? []).some(({ seriesId, status }) => seriesId === resolved.seriesId && status === "open")) return null;

  const resolvedAt = asDate(resolved.resolvedAt);
  if (asDate(at).getTime() < resolvedAt.getTime() + RENEWAL_COOLDOWN_MINUTES * MINUTE_MS) return null;

  const counterpartyName = residentName(state, resolved.counterpartyId, "the clerk");
  const ownerName = residentName(state, resolved.ownerId, "the courier");
  const destinationId = resolved.resolution === "fulfill"
    ? (resolved.destinationId === "town-hall" ? "square" : "town-hall")
    : resolved.destinationId;
  const destination = state.locations.find(({ id }) => id === destinationId);
  const relationship = relationshipBetween(state, resolved.ownerId, resolved.counterpartyId);
  const strained = (relationship?.strength ?? 0) < 45;
  const generation = resolved.generation + 1;
  const urgent = resolved.resolution !== "fulfill" || strained;

  return materializeObligation({
    id: `obligation-${resolved.seriesId}-${String(generation).padStart(2, "0")}`,
    kind: "delivery",
    ownerId: resolved.ownerId,
    counterpartyId: resolved.counterpartyId,
    destinationId,
    title: urgent ? `${counterpartyName}'s replacement notice` : `${counterpartyName}'s reply packet`,
    description: urgent
      ? `${counterpartyName} is giving ${ownerName} one more chance to carry a notice to ${destination?.name ?? destinationId}.`
      : `${counterpartyName} has another packet for ${ownerName}; it must reach ${destination?.name ?? destinationId} before the next market day.`,
    // Sal plans once per simulated day. Give even a strained commitment two
    // planning opportunities before the next deadline arrives; a one-day
    // rotation can otherwise place a deadline just before the next turn.
    dueAfterMinutes: urgent ? 60 * 60 : 72 * 60,
    renewable: true,
    seriesId: resolved.seriesId,
    generation,
    parentObligationId: resolved.id,
  }, at);
}

/**
 * Continue a renewable commitment series only when its prior outcome and
 * cooldown permit it. The open-obligation cap keeps this loop bounded.
 */
export function renewObligations(state, at) {
  const created = [];
  const resolved = [...(state.obligations ?? [])]
    .filter((obligation) => obligation.status !== "open")
    .sort((left, right) => String(left.resolvedAt).localeCompare(String(right.resolvedAt)));

  for (const obligation of resolved) {
    if ((state.obligations ?? []).filter(({ status }) => status === "open").length + created.length >= MAX_OPEN_OBLIGATIONS) break;
    const next = renewalCandidate(state, obligation, at);
    if (!next) continue;
    state.obligations.push(next);
    created.push(next);
  }
  return created;
}
