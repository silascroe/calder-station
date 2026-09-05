import { townSeed } from "./demo-data.js";
import { scriptedDailyPlan } from "./daily-plans.js";
import { estimateDeepSeekCost } from "./model-evaluation.js";
import { DEFAULT_REFLECTION_INTERVAL_DAYS, normalizeReflectionPolicy } from "./reflections.js";
import { runScenario } from "./scenario-runner.js";

export const REFLECTION_EVALUATION_REVISION = "sal-reflection-slice-v1-2026-09-01";
export const REFLECTION_EVALUATION_RESIDENT_ID = "sal";
export const REFLECTION_EVALUATION_TARGET_ID = "june";
export const REFLECTION_EVALUATION_DEFAULT_DAYS = 90;
export const REFLECTION_EVALUATION_DEFAULT_START_TIME = "2026-09-01T00:00:00.000Z";

const REFLECTION_EVALUATION_SEED = "calder-station-reflection-slice";
const REFLECTION_EVALUATION_FUTURE = "2099-01-01T00:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function relationshipBetween(state, firstId, secondId) {
  return (state.relationships ?? []).find((relationship) => (
    (relationship.fromId === firstId && relationship.toId === secondId)
    || (relationship.fromId === secondId && relationship.toId === firstId)
  ));
}

export function reflectionEvaluationSeedData() {
  const residentIds = new Set([REFLECTION_EVALUATION_RESIDENT_ID, REFLECTION_EVALUATION_TARGET_ID]);
  return clone({
    ...townSeed,
    residents: townSeed.residents.filter(({ id }) => residentIds.has(id)),
    relationships: townSeed.relationships
      .filter(({ fromId, toId }) => residentIds.has(fromId) && residentIds.has(toId))
      .map((relationship) => ({ ...relationship, interactionCount: 1 })),
    obligations: [],
  });
}

function prepareReflectionState(state) {
  for (const progress of Object.values(state.civicIncidents?.chains ?? {})) {
    progress.nextAt = REFLECTION_EVALUATION_FUTURE;
    progress.activeObligationId = null;
  }
  const resident = state.residents.find(({ id }) => id === REFLECTION_EVALUATION_RESIDENT_ID);
  resident.reflection.nextReflectionAt = state.now;
  return state;
}

export function scriptedReflectionAdapter({ resident } = {}) {
  if (resident?.id !== REFLECTION_EVALUATION_RESIDENT_ID) {
    return { focusTargetId: null, note: "ordinary routines still deserve attention", source: "scripted" };
  }
  return { focusTargetId: REFLECTION_EVALUATION_TARGET_ID, note: "Make time for June Collins.", source: "scripted" };
}

function compactResult(result, focusTargetId, wallClock) {
  const relationship = relationshipBetween(result.state, REFLECTION_EVALUATION_RESIDENT_ID, focusTargetId);
  const focusedEncounters = (result.state.events ?? []).filter((event) => (
    event.type === "encounter" && event.relationshipId === relationship?.id
  ));
  return {
    healthy: result.final.healthy,
    events: result.final.longHorizon.eventDiversity.total,
    encounters: result.final.stats.encounters,
    reflections: result.final.reflections,
    estimatedCostUsd: estimateDeepSeekCost({
      promptTokens: result.final.reflections.promptTokens,
      completionTokens: result.final.reflections.completionTokens,
      promptCacheHitTokens: result.final.reflections.promptCacheHitTokens,
      promptCacheMissTokens: result.final.reflections.promptCacheMissTokens,
    }, wallClock),
    focalRelationship: relationship
      ? { id: relationship.id, strength: relationship.strength, tension: relationship.tension, interactions: relationship.interactionCount }
      : null,
    focalEncounterCount: focusedEncounters.length,
    firstFocalEncounterAt: focusedEncounters[0]?.at ?? null,
    checkpoints: Object.fromEntries(Object.entries(result.checkpoints).map(([day, report]) => [day, {
      healthy: report.healthy,
      events: report.longHorizon.eventDiversity.total,
      encounters: report.stats.encounters,
      reflections: report.reflections,
    }])),
  };
}

export async function runReflectionComparison({
  days = REFLECTION_EVALUATION_DEFAULT_DAYS,
  checkpoints,
  seed = REFLECTION_EVALUATION_SEED,
  startTime = REFLECTION_EVALUATION_DEFAULT_START_TIME,
  tickMinutes = 24 * 60,
  mode = "accelerated",
  intervalDays = DEFAULT_REFLECTION_INTERVAL_DAYS,
  residentIds = [REFLECTION_EVALUATION_RESIDENT_ID],
  focusTargetId = REFLECTION_EVALUATION_TARGET_ID,
  reflectionAdapter = scriptedReflectionAdapter,
  wallClock = new Date("2026-09-01T00:30:00.000Z"),
} = {}) {
  if (!Array.isArray(residentIds) || residentIds.length !== 1 || residentIds[0] !== REFLECTION_EVALUATION_RESIDENT_ID) {
    throw new RangeError(`reflection comparison requires residentIds [${REFLECTION_EVALUATION_RESIDENT_ID}]`);
  }
  if (focusTargetId !== REFLECTION_EVALUATION_TARGET_ID) throw new RangeError(`reflection comparison requires focusTargetId ${REFLECTION_EVALUATION_TARGET_ID}`);
  if (typeof reflectionAdapter !== "function") throw new TypeError("reflectionAdapter must be a function");
  const effectiveWallClock = wallClock instanceof Date ? new Date(wallClock) : new Date(wallClock);
  if (Number.isNaN(effectiveWallClock.getTime())) throw new TypeError("wallClock must be a valid date");
  const policy = normalizeReflectionPolicy({ mode, intervalDays, residentIds });
  if (policy.mode === "disabled") throw new RangeError("reflection comparison requires an enabled policy");

  const scenarioOptions = {
    days,
    checkpoints,
    seed,
    startTime,
    tickMinutes,
    seedData: reflectionEvaluationSeedData(),
    decisionAdapter: scriptedDailyPlan,
    prepareState: prepareReflectionState,
    wallClock: effectiveWallClock,
  };
  const baseline = await runScenario(scenarioOptions);
  const assisted = await runScenario({ ...scenarioOptions, reflectionAdapter, reflectionPolicy: policy });
  const compactBaseline = compactResult(baseline, focusTargetId, effectiveWallClock);
  const compactAssisted = compactResult(assisted, focusTargetId, effectiveWallClock);
  const baselineStrength = compactBaseline.focalRelationship?.strength ?? 0;
  const assistedStrength = compactAssisted.focalRelationship?.strength ?? 0;
  const baselineInteractions = compactBaseline.focalRelationship?.interactions ?? 0;
  const assistedInteractions = compactAssisted.focalRelationship?.interactions ?? 0;
  return {
    kind: "calder-station-reflection-comparison",
    revision: REFLECTION_EVALUATION_REVISION,
    seed,
    days,
    policy,
    focus: { residentId: REFLECTION_EVALUATION_RESIDENT_ID, targetId: focusTargetId },
    baseline: compactBaseline,
    assisted: compactAssisted,
    divergence: {
      eventDelta: compactAssisted.events - compactBaseline.events,
      encounterDelta: compactAssisted.encounters - compactBaseline.encounters,
      focalEncounterDelta: compactAssisted.focalEncounterCount - compactBaseline.focalEncounterCount,
      focalRelationshipStrengthDelta: assistedStrength - baselineStrength,
      focalRelationshipInteractionDelta: assistedInteractions - baselineInteractions,
      firstAssistedFocalEncounterAt: compactAssisted.firstFocalEncounterAt,
    },
    estimatedCostUsd: compactAssisted.estimatedCostUsd,
  };
}
