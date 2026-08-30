function hourAt(date) {
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

function inWindow(hour, start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && hour >= start && hour < end;
}

function decision(action, locationId, reason, status, mood) {
  return { action, locationId, reason, status, mood };
}

/**
 * A deliberately ordinary game-AI policy. It takes bounded state and returns
 * an intent; it does not mutate the town or call a model.
 */
export function scriptedDecision({ resident, now } = {}) {
  if (!resident || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("scriptedDecision requires a resident and valid Date");
  }

  const routine = resident.routine ?? {};

  if (resident.energy <= 24) {
    return decision(
      "rest",
      resident.homeLocationId,
      "energy is running low",
      "Sleeping it off",
      "Calm",
    );
  }

  if (resident.hunger >= 72) {
    return decision(
      "eat",
      resident.locationId,
      "hunger is getting distracting",
      "Stopping for a meal",
      "Content",
    );
  }

  const hour = hourAt(now);

  // The first wake-up gives every seeded resident a visible reason to leave
  // home. Later wake-ups follow the ordinary work, meal, and evening rules.
  if ((resident.planCount ?? resident.decisionCount ?? 0) === 0) {
    return decision(
      routine.action ?? "work",
      resident.workLocationId,
      routine.workReason ?? "the day's work is waiting",
      routine.workStatus ?? "Starting the day's work",
      routine.workMood ?? "Focused",
    );
  }

  if (inWindow(hour, routine.mealStart, routine.mealEnd)) {
    return decision(
      "eat",
      routine.mealLocationId ?? resident.locationId,
      routine.mealReason ?? "it is time for a meal",
      routine.mealStatus ?? "Stopping for a meal",
      routine.mealMood ?? "Content",
    );
  }

  if (inWindow(hour, routine.workStart, routine.workEnd)) {
    return decision(
      routine.action ?? "work",
      resident.workLocationId,
      routine.workReason ?? "the day's work is waiting",
      routine.workStatus ?? "Working through the day",
      routine.workMood ?? "Focused",
    );
  }

  if (routine.eveningAction && inWindow(hour, routine.eveningStart, routine.eveningEnd)) {
    return decision(
      routine.eveningAction,
      routine.eveningLocationId ?? resident.locationId,
      routine.eveningReason ?? "the evening is worth noticing",
      routine.eveningStatus ?? "Out for the evening",
      routine.eveningMood ?? "Curious",
    );
  }

  return decision(
    "rest",
    resident.homeLocationId,
    "nothing urgent is demanding attention",
    "Resting at home",
    "Calm",
  );
}
