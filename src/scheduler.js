const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// DeepSeek's current published peak windows are UTC weekday windows.
export const DEFAULT_PEAK_WINDOWS_UTC = Object.freeze([
  Object.freeze({ startHour: 1, endHour: 4 }),
  Object.freeze({ startHour: 6, endHour: 10 }),
]);

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

function startOfUtcDay(value) {
  const date = asDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function peakWindowsForDay(value, peakWindows = DEFAULT_PEAK_WINDOWS_UTC) {
  const dayStart = startOfUtcDay(value);
  if (isWeekend(dayStart)) return [];

  return peakWindows.map(({ startHour, endHour }) => ({
    start: new Date(dayStart.getTime() + startHour * 60 * MINUTE_MS),
    end: new Date(dayStart.getTime() + endHour * 60 * MINUTE_MS),
  }));
}

export function isPeakPeriod(value, peakWindows = DEFAULT_PEAK_WINDOWS_UTC) {
  const date = asDate(value);
  return peakWindowsForDay(date, peakWindows).some(
    ({ start, end }) => date >= start && date < end,
  );
}

export function offPeakWindowsForDay(value, peakWindows = DEFAULT_PEAK_WINDOWS_UTC) {
  const dayStart = startOfUtcDay(value);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const peaks = peakWindowsForDay(dayStart, peakWindows);

  if (peaks.length === 0) {
    return [{ start: dayStart, end: dayEnd }];
  }

  const windows = [];
  let cursor = dayStart;

  for (const peak of peaks) {
    if (peak.start > cursor) {
      windows.push({ start: cursor, end: peak.start });
    }
    if (peak.end > cursor) cursor = peak.end;
  }

  if (cursor < dayEnd) {
    windows.push({ start: cursor, end: dayEnd });
  }

  return windows;
}

export function nextOffPeak(value, peakWindows = DEFAULT_PEAK_WINDOWS_UTC) {
  const date = asDate(value);
  if (!isPeakPeriod(date, peakWindows)) return date;

  const window = peakWindowsForDay(date, peakWindows).find(
    ({ start, end }) => date >= start && date < end,
  );
  return new Date(window.end.getTime());
}

export function scheduleDecision({ requestedAt, priority = "routine", peakWindows } = {}) {
  const requested = asDate(requestedAt);

  if (priority === "urgent") return requested;
  if (priority !== "routine") {
    throw new RangeError(`Unsupported decision priority: ${priority}`);
  }

  return nextOffPeak(requested, peakWindows);
}

/**
 * Decide whether a paid model request may run at the current wall-clock time.
 * Simulation time is deliberately not involved: provider pricing follows the
 * real request timestamp, while the town clock remains a world mechanic.
 */
export function modelCallPolicy({
  wallClock,
  priority = "routine",
  bypassPeakPricing = false,
  peakWindows,
} = {}) {
  const requestedAt = asDate(wallClock);
  if (bypassPeakPricing || priority === "urgent") {
    return { allowed: true, reason: bypassPeakPricing ? "evaluation-bypass" : "urgent", requestedAt };
  }
  if (priority !== "routine") {
    throw new RangeError(`Unsupported model-call priority: ${priority}`);
  }
  if (!isPeakPeriod(requestedAt, peakWindows)) {
    return { allowed: true, reason: "off-peak", requestedAt };
  }
  return {
    allowed: false,
    reason: "peak-pricing-window",
    requestedAt,
    nextEligibleAt: nextOffPeak(requestedAt, peakWindows),
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateKey(value) {
  return startOfUtcDay(value).toISOString().slice(0, 10);
}

/**
 * Build one routine decision slot per resident for a UTC day.
 * The result is deterministic for a given roster and day, but rotates by day.
 * Provider pricing is deliberately absent: simulated lives use the whole
 * fictional day, while modelCallPolicy governs the real request timestamp.
 */
export function spreadDailyDecisionTimes({ day, residentIds } = {}) {
  if (!Array.isArray(residentIds)) {
    throw new TypeError("residentIds must be an array");
  }

  const ids = [...residentIds];
  if (new Set(ids).size !== ids.length) {
    throw new RangeError("residentIds must not contain duplicates");
  }
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new TypeError("residentIds must contain non-empty strings");
  }
  if (ids.length === 0) return [];

  const sortedIds = [...ids].sort();
  const dayStart = startOfUtcDay(day);
  const totalMinutes = DAY_MS / MINUTE_MS;
  const rotation = stableHash(`${dateKey(day)}:${sortedIds.join("\u0000")}`) % sortedIds.length;

  return sortedIds.map((residentId, index) => {
    const slotIndex = (index + rotation) % sortedIds.length;
    const offsetMinutes = Math.floor(((slotIndex + 0.5) * totalMinutes) / sortedIds.length);
    const requestedAt = new Date(dayStart.getTime() + Math.min(offsetMinutes, totalMinutes - 1) * MINUTE_MS);

    return {
      residentId,
      requestedAt,
      scheduledAt: requestedAt,
      priority: "routine",
    };
  });
}
