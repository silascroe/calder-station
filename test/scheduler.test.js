import test from "node:test";
import assert from "node:assert/strict";

import {
  isPeakPeriod,
  nextOffPeak,
  offPeakWindowsForDay,
  scheduleDecision,
  spreadDailyDecisionTimes,
} from "../src/scheduler.js";

test("recognizes DeepSeek weekday peak windows", () => {
  assert.equal(isPeakPeriod("2026-08-31T00:59:59Z"), false);
  assert.equal(isPeakPeriod("2026-08-31T01:00:00Z"), true);
  assert.equal(isPeakPeriod("2026-08-31T03:59:59Z"), true);
  assert.equal(isPeakPeriod("2026-08-31T04:00:00Z"), false);
  assert.equal(isPeakPeriod("2026-08-31T06:00:00Z"), true);
  assert.equal(isPeakPeriod("2026-08-31T09:59:59Z"), true);
  assert.equal(isPeakPeriod("2026-08-31T10:00:00Z"), false);
  assert.equal(isPeakPeriod("2026-09-05T02:00:00Z"), false);
});

test("routine decisions wait for the current peak window to end", () => {
  assert.equal(
    nextOffPeak("2026-08-31T02:15:00Z").toISOString(),
    "2026-08-31T04:00:00.000Z",
  );
  assert.equal(
    scheduleDecision({ requestedAt: "2026-08-31T08:45:00Z" }).toISOString(),
    "2026-08-31T10:00:00.000Z",
  );
  assert.equal(
    scheduleDecision({ requestedAt: "2026-08-31T08:45:00Z", priority: "urgent" }).toISOString(),
    "2026-08-31T08:45:00.000Z",
  );
});

test("weekends are entirely available for routine work", () => {
  const windows = offPeakWindowsForDay("2026-09-05T12:00:00Z");
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(windows[0].end.toISOString(), "2026-09-06T00:00:00.000Z");
});

test("daily decision slots are spread and never land in peak time", () => {
  const residentIds = Array.from({ length: 12 }, (_, index) => `resident-${index}`);
  const plan = spreadDailyDecisionTimes({
    day: "2026-08-31T00:00:00Z",
    residentIds,
  });
  const timestamps = plan.map(({ scheduledAt }) => scheduledAt.getTime());

  assert.equal(plan.length, residentIds.length);
  assert.equal(new Set(timestamps).size, residentIds.length);
  assert.ok(plan.every(({ scheduledAt }) => !isPeakPeriod(scheduledAt)));
  assert.ok(Math.max(...timestamps) - Math.min(...timestamps) > 4 * 60 * 60 * 1000);
});

test("the same roster and day produce the same plan", () => {
  const input = {
    day: "2026-08-31T00:00:00Z",
    residentIds: ["mara", "otis", "sal"],
  };
  const first = spreadDailyDecisionTimes(input);
  const second = spreadDailyDecisionTimes(input);

  assert.deepEqual(
    first.map(({ residentId, scheduledAt }) => [residentId, scheduledAt.toISOString()]),
    second.map(({ residentId, scheduledAt }) => [residentId, scheduledAt.toISOString()]),
  );
});

