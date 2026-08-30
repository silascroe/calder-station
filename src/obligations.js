import { OBLIGATION_CHOICES, scriptedDailyPlan } from "./daily-plans.js";

const MINUTE_MS = 60 * 1000;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return date;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function relationshipBetween(state, firstId, secondId) {
  return (state.relationships ?? []).find((relationship) => (
    (relationship.fromId === firstId && relationship.toId === secondId)
    || (relationship.fromId === secondId && relationship.toId === firstId)
  ));
}

export function materializeObligation(seed, startedAt) {
  const createdAt = asDate(startedAt);
  const dueAt = new Date(createdAt.getTime() + Number(seed.dueAfterMinutes ?? 0) * MINUTE_MS);
  return {
    ...seed,
    createdAt: createdAt.toISOString(),
    dueAt: dueAt.toISOString(),
    status: seed.status ?? "open",
    resolvedAt: seed.resolvedAt ?? null,
    resolution: seed.resolution ?? null,
    resolutionNote: seed.resolutionNote ?? null,
  };
}

export function openObligationFor(state, residentId) {
  return (state.obligations ?? []).find((obligation) => (
    obligation.ownerId === residentId && obligation.status === "open"
  ));
}

/**
 * Scripted fallback for the one model experiment. It makes a concrete choice
 * so the town remains playable even when DeepSeek is unavailable.
 */
export function scriptedObligationPlan({ town, resident, now } = {}) {
  const base = scriptedDailyPlan({ town, resident, now });
  const obligation = openObligationFor(town, resident.id);
  if (!obligation) return base;

  const canTakeDirectRoute = resident.energy > 35;
  const action = canTakeDirectRoute
    ? {
      ...base.actions[0],
      action: "deliver",
      locationId: obligation.destinationId,
      reason: `${obligation.title} is due before noon`,
      status: "Taking the direct route",
      mood: "Determined",
    }
    : {
      ...base.actions[0],
      action: "observe",
      locationId: resident.locationId,
      reason: "energy is too low to make the promised detour",
      status: "Reporting a delay",
      mood: "Uneasy",
    };

  return {
    ...base,
    priorities: [
      canTakeDirectRoute ? "fulfill the sealed notice" : "report the delayed sealed notice",
      "keep the regular route from unraveling",
    ],
    actions: [action],
    socialIntentions: [],
    obligationDecision: {
      obligationId: obligation.id,
      choice: canTakeDirectRoute ? "fulfill" : "report_delay",
      note: canTakeDirectRoute ? "the direct route is still possible" : "the detour would risk the rest of the route",
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
  relationship.strength = clamp(relationship.strength + (fulfilling ? 2 : -2));

  const destination = state.locations.find(({ id }) => id === obligation.destinationId);
  return {
    actorId: resident.id,
    relatedActorId: counterparty.id,
    locationId: fulfilling ? obligation.destinationId : resident.locationId,
    relationshipId: relationship.id,
    type: "obligation",
    text: fulfilling
      ? `delivered ${obligation.title.toLowerCase()} to ${destination?.name ?? obligation.destinationId}`
      : `reported a delay on ${obligation.title.toLowerCase()}`,
    reason: decision.note ?? null,
  };
}
