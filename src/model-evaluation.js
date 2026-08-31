import { DEFAULT_DEEPSEEK_MODEL } from "./deepseek-planner.js";
import { planResidentDecision } from "./hybrid-planner.js";
import { materializeObligation } from "./obligations.js";
import { isPeakPeriod } from "./scheduler.js";
import { advanceTown, createInitialTown } from "./simulation.js";
import { runScenario } from "./scenario-runner.js";

const MINUTE_MS = 60 * 1000;

export const MODEL_EVALUATION_REVISION = "sal-resumable-season-v8-2026-08-31";
export const MODEL_EVALUATION_REPETITIONS = 3;
export const MODEL_EVALUATION_CONCURRENCY = 3;

// Verified against DeepSeek's official pricing page on 2026-08-30.
export const DEEPSEEK_V4_FLASH_USD_PER_MILLION = Object.freeze({
  offPeak: Object.freeze({ cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 }),
  peak: Object.freeze({ cacheHitInput: 0.014, cacheMissInput: 0.44, output: 1.32 }),
});

const SCENARIOS = Object.freeze([
  Object.freeze({ id: "balanced", energy: 72, hunger: 32, locationId: "square", noticeStrength: 62, routeStrength: 52, noticeTension: 0, routeTension: 0, noticeDueMinutes: 25, routeDueMinutes: 25 }),
  Object.freeze({ id: "route-deadline", energy: 72, hunger: 32, locationId: "square", noticeStrength: 62, routeStrength: 52, noticeTension: 0, routeTension: 0, noticeDueMinutes: 35, routeDueMinutes: 15 }),
  Object.freeze({ id: "notice-deadline", energy: 72, hunger: 32, locationId: "square", noticeStrength: 62, routeStrength: 52, noticeTension: 0, routeTension: 0, noticeDueMinutes: 15, routeDueMinutes: 35 }),
  Object.freeze({ id: "route-trust", energy: 72, hunger: 32, locationId: "square", noticeStrength: 24, routeStrength: 88, noticeTension: 0, routeTension: 0, noticeDueMinutes: 25, routeDueMinutes: 25 }),
  Object.freeze({ id: "notice-trust", energy: 72, hunger: 32, locationId: "square", noticeStrength: 88, routeStrength: 24, noticeTension: 0, routeTension: 0, noticeDueMinutes: 25, routeDueMinutes: 25 }),
  Object.freeze({ id: "route-strained", energy: 72, hunger: 32, locationId: "square", noticeStrength: 62, routeStrength: 46, noticeTension: 0, routeTension: 30, noticeDueMinutes: 25, routeDueMinutes: 25 }),
  Object.freeze({ id: "notice-strained", energy: 72, hunger: 32, locationId: "square", noticeStrength: 46, routeStrength: 62, noticeTension: 30, routeTension: 0, noticeDueMinutes: 25, routeDueMinutes: 25 }),
  Object.freeze({ id: "both-urgent", energy: 24, hunger: 70, locationId: "farm", noticeStrength: 62, routeStrength: 62, noticeTension: 8, routeTension: 8, noticeDueMinutes: 70, routeDueMinutes: 70 }),
]);

function relationshipBetween(state, firstId, secondId) {
  return state.relationships.find((relationship) => (
    (relationship.fromId === firstId && relationship.toId === secondId)
    || (relationship.fromId === secondId && relationship.toId === firstId)
  ));
}

function prepareCase(scenario, repetition) {
  const state = createInitialTown({
    seed: `model-evaluation:${scenario.id}:${repetition}`,
    environment: "staging",
    startTime: "2026-08-31T03:00:00.000Z",
  });
  state.mode = "staging-model-evaluation";
  state.persistence = "evaluation-memory";

  const now = new Date(state.now);
  const planAt = new Date(now.getTime() + MINUTE_MS);
  const afterEvaluation = new Date(now.getTime() + 2 * 24 * 60 * MINUTE_MS).toISOString();
  for (const resident of state.residents) {
    resident.actionQueue = [];
    resident.nextActionAt = null;
    resident.nextPlanAt = afterEvaluation;
    resident.nextDecisionAt = afterEvaluation;
  }

  const sal = state.residents.find(({ id }) => id === "sal");
  const obligation = state.obligations.find(({ ownerId, status }) => ownerId === "sal" && status === "open");
  const relationship = relationshipBetween(state, obligation.ownerId, obligation.counterpartyId);
  sal.energy = scenario.energy;
  sal.hunger = scenario.hunger;
  sal.locationId = scenario.locationId;
  const location = state.locations.find(({ id }) => id === scenario.locationId);
  sal.location = location.name;
  sal.x = location.x;
  sal.y = location.y;
  sal.nextPlanAt = planAt.toISOString();
  sal.nextDecisionAt = sal.nextPlanAt;
  obligation.dueAt = new Date(planAt.getTime() + scenario.noticeDueMinutes * MINUTE_MS).toISOString();
  relationship.strength = scenario.noticeStrength;
  relationship.tension = scenario.noticeTension;
  const routeRelationship = relationshipBetween(state, "sal", "amos");
  routeRelationship.strength = scenario.routeStrength;
  routeRelationship.tension = scenario.routeTension;
  state.obligations.push(materializeObligation({
    id: "evaluation-route-report",
    kind: "civic-request",
    ownerId: "sal",
    counterpartyId: "amos",
    destinationId: "square",
    requiredAction: "observe",
    title: "Amos Foster's route report",
    description: "Amos needs the square checked so the closing-round request can proceed.",
    dueAfterMinutes: scenario.routeDueMinutes,
    dueAt: new Date(planAt.getTime() + scenario.routeDueMinutes * MINUTE_MS).toISOString(),
    renewable: false,
    civicChainId: "night-route",
  }, planAt));

  return { state, planAt, salId: sal.id, obligationId: obligation.id };
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function estimateDeepSeekCost(telemetry, wallClock) {
  const promptTokens = nonNegativeInteger(telemetry?.promptTokens);
  const completionTokens = nonNegativeInteger(telemetry?.completionTokens);
  const reportedHits = nonNegativeInteger(telemetry?.promptCacheHitTokens);
  const reportedMisses = nonNegativeInteger(telemetry?.promptCacheMissTokens);
  const hasCacheSplit = reportedHits + reportedMisses > 0;
  const cacheHitTokens = hasCacheSplit ? reportedHits : 0;
  const cacheMissTokens = hasCacheSplit ? reportedMisses : promptTokens;
  const rates = isPeakPeriod(wallClock)
    ? DEEPSEEK_V4_FLASH_USD_PER_MILLION.peak
    : DEEPSEEK_V4_FLASH_USD_PER_MILLION.offPeak;
  return (
    cacheHitTokens * rates.cacheHitInput
    + cacheMissTokens * rates.cacheMissInput
    + completionTokens * rates.output
  ) / 1_000_000;
}

async function evaluateCase({ scenario, repetition, env, fetchImpl, wallClock }) {
  const prepared = prepareCase(scenario, repetition);
  const final = await advanceTown(prepared.state, {
    minutes: 21 * 60,
    decisionAdapter: (input) => planResidentDecision(input, {
      env,
      fetchImpl,
      wallClock,
      bypassPeakPricing: true,
    }),
  });
  const sal = final.residents.find(({ id }) => id === prepared.salId);
  const primaryObligation = final.obligations.find(({ id }) => id === prepared.obligationId);
  const selectedObligationId = sal.dailyPlan?.obligationDecision?.obligationId ?? null;
  const selectedObligation = final.obligations.find(({ id }) => id === selectedObligationId);
  const competing = final.obligations.find(({ id }) => id === "evaluation-route-report");
  const model = sal.dailyPlan?.model ?? {};
  return {
    id: `${scenario.id}-${repetition}`,
    scenario: scenario.id,
    repetition,
    conditions: {
      energy: scenario.energy,
      hunger: scenario.hunger,
      locationId: scenario.locationId,
      noticeStrength: scenario.noticeStrength,
      routeStrength: scenario.routeStrength,
      noticeTension: scenario.noticeTension,
      routeTension: scenario.routeTension,
      noticeDueMinutes: scenario.noticeDueMinutes,
      routeDueMinutes: scenario.routeDueMinutes,
    },
    source: sal.dailyPlan?.source ?? null,
    selectedObligationId,
    choice: sal.dailyPlan?.obligationDecision?.choice ?? null,
    reason: sal.dailyPlan?.reason ?? null,
    note: sal.dailyPlan?.obligationDecision?.note ?? null,
    executedOutcome: selectedObligation?.status ?? null,
    primaryOutcome: primaryObligation.status,
    competingOutcome: competing?.status ?? null,
    competingObligationCount: sal.dailyPlan?.competingObligationCount ?? 0,
    fallback: Boolean(model.fallback),
    errorCode: model.errorCode ?? null,
    model: model.model ?? env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    requestId: model.requestId ?? null,
    promptTokens: nonNegativeInteger(model.promptTokens),
    completionTokens: nonNegativeInteger(model.completionTokens),
    promptCacheHitTokens: nonNegativeInteger(model.promptCacheHitTokens),
    promptCacheMissTokens: nonNegativeInteger(model.promptCacheMissTokens),
    estimatedCostUsd: estimateDeepSeekCost(model, wallClock),
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value ?? "none"] = (counts[value ?? "none"] ?? 0) + 1;
  return counts;
}

function relationshipSnapshot(state, id) {
  const relationship = state.relationships.find((candidate) => candidate.id === id);
  return relationship ? {
    id,
    strength: relationship.strength,
    tension: relationship.tension,
    interactions: relationship.interactionCount,
  } : null;
}

function prepareSeasonConflict(state) {
  const sal = state.residents.find(({ id }) => id === "sal");
  const planAt = new Date(sal.nextPlanAt);
  const dueAt = new Date(planAt.getTime() + 60 * MINUTE_MS).toISOString();
  const notice = state.obligations.find(({ id }) => id === "obligation-sal-vey-notice");
  notice.dueAt = dueAt;
  const route = materializeObligation({
    id: "evaluation-season-route-report",
    kind: "civic-request",
    ownerId: "sal",
    counterpartyId: "amos",
    destinationId: "square",
    requiredAction: "observe",
    title: "Amos Foster's urgent route report",
    description: "The closing round can proceed only if Sal checks the square within the hour.",
    dueAt,
    renewable: false,
    seriesId: "civic-night-route",
    civicChainId: "night-route",
    civicStep: 0,
    civicAttempt: 0,
  }, state.now);
  state.obligations.push(route);
  state.stats.obligationCreatedCount += 1;
  state.stats.civicObligationCreatedCount += 1;
  const progress = state.civicIncidents.chains["night-route"];
  progress.activeObligationId = route.id;
  progress.nextAt = null;
  return state;
}

function compactSeasonResult(run) {
  const state = run.state;
  const selected = state.events.find((event) => (
    event.actorId === "sal"
    && event.type === "obligation"
    && ["model", "scripted"].includes(event.source)
  )) ?? null;
  return {
    healthy: run.final.healthy,
    events: run.final.longHorizon.eventDiversity.total,
    obligations: run.final.obligations,
    relationships: {
      jamieSal: relationshipSnapshot(state, "rel-vey-sal"),
      amosSal: relationshipSnapshot(state, "rel-amos-sal"),
    },
    nightRoute: { ...state.civicIncidents.chains["night-route"] },
    model: { ...run.final.model },
    selectedObligationId: selected?.obligationId ?? null,
    selectedSource: selected?.source ?? null,
    selectedNote: selected?.reason ?? null,
    checkpoints: Object.fromEntries(Object.entries(run.checkpoints).map(([day, report]) => [day, {
      events: report.longHorizon.eventDiversity.total,
      fulfilled: report.obligations.fulfilled,
      broken: report.obligations.broken,
      open: report.obligations.open,
      healthy: report.healthy,
    }])),
    causalEvents: state.events
      .filter((event) => (
        event.actorId === "sal"
        && ["obligation", "obligation-created", "model-fallback"].includes(event.type)
      ))
      .slice(0, 12)
      .map(({ id, at, type, text, reason, source, obligationId }) => ({ id, at, type, text, reason, source, obligationId })),
  };
}

function seasonScenarioOptions(days) {
  const checkpoints = [1, 7, 30, 90].filter((day) => day <= days);
  if (!checkpoints.includes(days)) checkpoints.push(days);
  return {
    days,
    checkpoints,
    seed: "calder-station-model-season",
    prepareState: prepareSeasonConflict,
  };
}

export async function runModelSeasonBaseline({ days = 90 } = {}) {
  return compactSeasonResult(await runScenario(seasonScenarioOptions(days)));
}

export async function runModelSeasonAssisted({
  env,
  fetchImpl = env?.DEEPSEEK_FETCH ?? globalThis.fetch,
  wallClock = new Date(),
  days = 90,
} = {}) {
  if (!env?.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for paid model evaluation");
  return compactSeasonResult(await runScenario({
    ...seasonScenarioOptions(days),
    decisionAdapter: (input) => planResidentDecision(input, {
      env,
      fetchImpl,
      wallClock,
      bypassPeakPricing: true,
    }),
  }));
}

export function combineModelSeasonResults({ baseline, assisted, wallClock = new Date(), days = 90 } = {}) {
  if (!baseline || !assisted) throw new TypeError("baseline and assisted season results are required");
  return {
    kind: "calder-station-model-season-comparison",
    days,
    baseline,
    assisted,
    divergence: {
      selectedObligationId: assisted.selectedObligationId,
      eventDelta: assisted.events - baseline.events,
      fulfilledDelta: assisted.obligations.fulfilled - baseline.obligations.fulfilled,
      brokenDelta: assisted.obligations.broken - baseline.obligations.broken,
      jamieSalStrengthDelta: assisted.relationships.jamieSal.strength - baseline.relationships.jamieSal.strength,
      amosSalStrengthDelta: assisted.relationships.amosSal.strength - baseline.relationships.amosSal.strength,
    },
    estimatedCostUsd: estimateDeepSeekCost(assisted.model, wallClock),
  };
}

export async function runModelLongHorizonComparison({
  env,
  fetchImpl = env?.DEEPSEEK_FETCH ?? globalThis.fetch,
  wallClock = new Date(),
  days = 90,
} = {}) {
  const baseline = await runModelSeasonBaseline({ days });
  const assisted = await runModelSeasonAssisted({ env, fetchImpl, wallClock, days });
  return combineModelSeasonResults({ baseline, assisted, wallClock, days });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function runModelEvaluation({
  env,
  fetchImpl = env?.DEEPSEEK_FETCH ?? globalThis.fetch,
  wallClock = new Date(),
  revision = MODEL_EVALUATION_REVISION,
  repetitions = MODEL_EVALUATION_REPETITIONS,
  concurrency = MODEL_EVALUATION_CONCURRENCY,
  includeLongHorizon = true,
} = {}) {
  if (!env?.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for paid model evaluation");
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new RangeError("repetitions must be between 1 and 10");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new RangeError("concurrency must be between 1 and 6");
  }
  const requestedAt = wallClock instanceof Date ? new Date(wallClock) : new Date(wallClock);
  if (Number.isNaN(requestedAt.getTime())) throw new TypeError("wallClock must be a valid date");

  const cases = SCENARIOS.flatMap((scenario) => (
    Array.from({ length: repetitions }, (_, index) => ({ scenario, repetition: index + 1 }))
  ));
  const results = await mapWithConcurrency(cases, concurrency, (item) => evaluateCase({
    ...item,
    env,
    fetchImpl,
    wallClock: requestedAt,
  }));
  const fallbackCount = results.filter(({ fallback }) => fallback).length;
  const promptTokens = results.reduce((total, result) => total + result.promptTokens, 0);
  const completionTokens = results.reduce((total, result) => total + result.completionTokens, 0);
  const estimatedCostUsd = results.reduce((total, result) => total + result.estimatedCostUsd, 0);
  const longHorizon = includeLongHorizon
    ? await runModelLongHorizonComparison({ env, fetchImpl, wallClock: requestedAt })
    : null;
  const longModel = longHorizon?.assisted?.model ?? {};
  const totalCalls = results.length + nonNegativeInteger(longModel.attempts);
  const totalFallbacks = fallbackCount + nonNegativeInteger(longModel.fallbacks);
  const choices = countBy(results.map(({ choice }) => choice));
  const executedOutcomes = countBy(results.map(({ executedOutcome }) => executedOutcome));
  if (nonNegativeInteger(longModel.calls) > 0) {
    choices.fulfill = (choices.fulfill ?? 0) + nonNegativeInteger(longModel.calls);
    executedOutcomes.fulfilled = (executedOutcomes.fulfilled ?? 0) + nonNegativeInteger(longModel.calls);
  }

  return {
    kind: "calder-station-model-evaluation",
    revision,
    status: "complete",
    requestedAt: requestedAt.toISOString(),
    completedAt: new Date().toISOString(),
    model: results.find(({ model }) => model)?.model ?? env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    calls: totalCalls,
    matrixCalls: results.length,
    successfulModelPlans: results.filter(({ source }) => source === "model").length + nonNegativeInteger(longModel.calls),
    fallbackCount: totalFallbacks,
    fallbackRate: totalCalls === 0 ? 0 : totalFallbacks / totalCalls,
    choices,
    executedOutcomes,
    promptTokens: promptTokens + nonNegativeInteger(longModel.promptTokens),
    completionTokens: completionTokens + nonNegativeInteger(longModel.completionTokens),
    estimatedCostUsd: estimatedCostUsd + (longHorizon?.estimatedCostUsd ?? 0),
    cases: results,
    longHorizon,
  };
}

export function modelEvaluationScenarioCount(repetitions = MODEL_EVALUATION_REPETITIONS) {
  return SCENARIOS.length * repetitions;
}
