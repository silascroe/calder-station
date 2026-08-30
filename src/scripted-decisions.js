function hourAt(date) {
  return date.getUTCHours() + date.getUTCMinutes() / 60;
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

  if (resident.decisionCount === 0) {
    if (resident.id === "mara") {
      return decision(
        "work",
        resident.workLocationId,
        "the bakery needs someone on duty",
        "Working a late bakery shift",
        "Focused",
      );
    }
    if (resident.id === "otis") {
      return decision(
        "work",
        resident.workLocationId,
        "a repair is waiting at the workshop",
        "Taking a late repair shift",
        "Irritated",
      );
    }
    if (resident.id === "sal") {
      return decision(
        "deliver",
        resident.workLocationId,
        "the first courier route is ready",
        "Checking the delivery board",
        "Alert",
      );
    }
  }

  if (resident.id === "mara") {
    if (hour >= 5 && hour < 12) {
      return decision(
        "work",
        resident.workLocationId,
        "the bakery shift is beginning",
        "Opening the ovens",
        "Focused",
      );
    }
    if (hour >= 12 && hour < 14) {
      return decision(
        "eat",
        resident.workLocationId,
        "the morning shift is over",
        "Eating behind the bakery",
        "Content",
      );
    }
    return decision(
      "rest",
      resident.homeLocationId,
      "the bakery day is finished",
      "Heading home to rest",
      "Relieved",
    );
  }

  if (resident.id === "otis") {
    if (hour >= 8 && hour < 18) {
      return decision(
        "work",
        resident.workLocationId,
        "the workshop is open",
        "Sorting a stubborn gearbox",
        "Irritated",
      );
    }
    if (hour >= 18 && hour < 20) {
      return decision(
        "eat",
        resident.workLocationId,
        "the workshop shift is winding down",
        "Eating beside the workshop",
        "Hungry",
      );
    }
    return decision(
      "rest",
      resident.homeLocationId,
      "the tools can wait until morning",
      "Turning in for the night",
      "Quiet",
    );
  }

  if (resident.id === "sal") {
    if (hour >= 9 && hour < 18) {
      return decision(
        "deliver",
        resident.workLocationId,
        "the courier route is active",
        "Checking the delivery board",
        "Alert",
      );
    }
    if (hour >= 18 && hour < 21) {
      return decision(
        "observe",
        "square",
        "the evening crowd is worth watching",
        "Watching the square",
        "Curious",
      );
    }
    return decision(
      "rest",
      resident.homeLocationId,
      "the roads are quiet",
      "Walking home",
      "Unwound",
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
