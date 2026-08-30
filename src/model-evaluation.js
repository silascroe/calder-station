import { DEFAULT_DEEPSEEK_MODEL } from "./deepseek-planner.js";
import { planResidentDecision } from "./hybrid-planner.js";
import { isPeakPeriod } from "./scheduler.js";
import { advanceTown, createInitialTown } from "./simulation.js";

const MINUTE_MS = 60 * 1000;

export const MODEL_EVALUATION_REVISION = "sal-obligation-v1-2026-08-30";
export const MODEL_EVALUATION_REPETITIONS = 3;
export const MODEL_EVALUATION_CONCURRENCY = 3;

// Verified against DeepSeek's official pricing page on 2026-08-30.
export const DEEPSEEK_V4_FLASH_USD_PER_MILLION = Object.freeze({
  offPeak: Object.freeze({ cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 }),
  peak: Object.freeze({ cacheHitInput: 0.014, cacheMissInput: 0.44, output: 1.32 }),
});

const SCENARIOS = Object.freeze([
  Object.freeze({ id: "baseline", energy: 72, hunger: 32, locationId: "square", relationship: 62, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "already-there", energy: 72, hunger: 32, locationId: "town-hall", relationship: 62, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "tired-and-far", energy: 24, hunger: 32, locationId: "farm", relationship: 62, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "hungry-and-far", energy: 68, hunger: 94, locationId: "farm", relationship: 62, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "low-trust", energy: 72, hunger: 32, locationId: "square", relationship: 18, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "high-trust", energy: 72, hunger: 32, locationId: "square", relationship: 92, dueMinutes: 8 * 60 }),
  Object.freeze({ id: "deadline-near", energy: 72, hunger: 32, locationId: "farm", relationship: 62, dueMinutes: 30 }),
  Object.freeze({ id: "deadline-distant", energy: 72, hunger: 32, locationId: "farm", relationship: 62, dueMinutes: 24 * 60 }),
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
  obligation.dueAt = new Date(now.getTime() + scenario.dueMinutes * MINUTE_MS).toISOString();
  relationship.strength = scenario.relationship;

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
    minutes: 5,
    decisionAdapter: (input) => planResidentDecision(input, {
      env,
      fetchImpl,
      wallClock,
      bypassPeakPricing: true,
    }),
  });
  const sal = final.residents.find(({ id }) => id === prepared.salId);
  const obligation = final.obligations.find(({ id }) => id === prepared.obligationId);
  const model = sal.dailyPlan?.model ?? {};
  return {
    id: `${scenario.id}-${repetition}`,
    scenario: scenario.id,
    repetition,
    conditions: {
      energy: scenario.energy,
      hunger: scenario.hunger,
      locationId: scenario.locationId,
      relationship: scenario.relationship,
      dueMinutes: scenario.dueMinutes,
    },
    source: sal.dailyPlan?.source ?? null,
    choice: sal.dailyPlan?.obligationDecision?.choice ?? null,
    reason: sal.dailyPlan?.reason ?? null,
    note: sal.dailyPlan?.obligationDecision?.note ?? null,
    executedOutcome: obligation.status,
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

  return {
    kind: "calder-station-model-evaluation",
    revision,
    status: "complete",
    requestedAt: requestedAt.toISOString(),
    completedAt: new Date().toISOString(),
    model: results.find(({ model }) => model)?.model ?? env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    calls: results.length,
    successfulModelPlans: results.filter(({ source }) => source === "model").length,
    fallbackCount,
    fallbackRate: results.length === 0 ? 0 : fallbackCount / results.length,
    choices: countBy(results.map(({ choice }) => choice)),
    executedOutcomes: countBy(results.map(({ executedOutcome }) => executedOutcome)),
    promptTokens,
    completionTokens,
    estimatedCostUsd,
    cases: results,
  };
}

export function modelEvaluationScenarioCount(repetitions = MODEL_EVALUATION_REPETITIONS) {
  return SCENARIOS.length * repetitions;
}
