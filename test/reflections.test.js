import test from "node:test";
import assert from "node:assert/strict";

import { createInitialTown } from "../src/simulation.js";
import {
  buildReflectionMessages,
  createDeepSeekReflection,
  deepSeekReflectionAdapter,
} from "../src/deepseek-reflection.js";
import {
  applyReflection,
  activeReflectionFocus,
  ensureReflectionSchedule,
  normalizeReflectionPolicy,
  reflectionIsDue,
  reflectionTargetOptions,
  validateReflection,
} from "../src/reflections.js";
import { runReflectionComparison } from "../src/reflection-evaluation.js";
import {
  advanceScenarioRun,
  createScenarioRun,
  runScenario,
  scenarioRunResult,
} from "../src/scenario-runner.js";

const env = { DEEPSEEK_API_KEY: "test-key" };

function reflectionInput() {
  const state = createInitialTown({ startTime: "2026-09-01T00:00:00.000Z" });
  return { state, resident: state.residents.find(({ id }) => id === "sal"), now: new Date("2026-09-01T06:00:00.000Z") };
}

function providerPayload(content, overrides = {}) {
  return {
    id: "chatcmpl-reflection-test",
    model: "deepseek-v4-flash",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: {
      prompt_tokens: 420,
      completion_tokens: 24,
      total_tokens: 444,
      prompt_cache_hit_tokens: 100,
      prompt_cache_miss_tokens: 320,
    },
    ...overrides,
  };
}

test("reflection cadence is deterministic and focus expires after the next decision", () => {
  const { state, resident } = reflectionInput();
  const policy = normalizeReflectionPolicy({ mode: "fast_test", intervalDays: 7, residentIds: ["sal"] });
  const schedule = ensureReflectionSchedule(resident, state.startedAt, policy);
  assert.equal(schedule.staggerDays >= 0 && schedule.staggerDays < 7, true);
  assert.equal(reflectionIsDue(resident, new Date(schedule.nextReflectionAt).getTime() - 1, policy), false);
  assert.equal(reflectionIsDue(resident, schedule.nextReflectionAt, policy), true);
  applyReflection(resident, { focusTargetId: "june", note: "Make time for June." }, schedule.nextReflectionAt, policy, { town: state });
  assert.equal(activeReflectionFocus(resident), "june");
  resident.lastDecisionAt = resident.reflection.lastReflectedAt;
  assert.equal(activeReflectionFocus(resident), null);
});

test("reflection output is limited to one legal relationship focus and a short note", () => {
  const { state, resident } = reflectionInput();
  assert.ok(reflectionTargetOptions(state, resident).some(({ targetId }) => targetId === "june"));
  assert.deepEqual(validateReflection({ focusTargetId: "june", note: "Make time for June." }, { town: state, resident }), {
    focusTargetId: "june", note: "Make time for June.",
  });
  assert.throws(() => validateReflection({ focusTargetId: "unknown", note: "No." }, { town: state, resident }), /recorded relationship/);
  assert.throws(() => validateReflection({ focusTargetId: "june", note: "No.", action: "teleport" }, { town: state, resident }), /bounded focus contract/);
  assert.throws(() => validateReflection({ focusTargetId: null, note: "x".repeat(161) }, { town: state, resident }), /under 160 characters/);
});

test("DeepSeek reflection requests carry bounded context and usage telemetry", async () => {
  const input = reflectionInput();
  let request;
  const result = await createDeepSeekReflection({
    ...input,
    policy: { mode: "accelerated", intervalDays: 24, residentIds: ["sal"] },
    env,
    wallClock: "2026-09-01T00:30:00.000Z",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify(providerPayload(JSON.stringify({ focusTargetId: "june", note: "Make time for June." }))));
    },
  });
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(body.response_format.type, "json_object");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 120);
  assert.equal(body.messages[0].content.includes("test-key"), false);
  assert.equal(body.messages[1].content.includes("Sal D’Amico"), true);
  const context = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
  assert.ok(context.legalFocusTargets.some(({ targetId }) => targetId === "june"));
  assert.equal(result.source, "model");
  assert.equal(result.modelTelemetry.promptTokens, 420);
  assert.equal(result.modelTelemetry.promptCacheMissTokens, 320);
});

test("malformed DeepSeek reflection output stays outside the simulation boundary", async () => {
  const input = reflectionInput();
  await assert.rejects(createDeepSeekReflection({
    ...input,
    policy: { mode: "accelerated", intervalDays: 24, residentIds: ["sal"] },
    env,
    wallClock: "2026-09-01T00:30:00.000Z",
    fetchImpl: async () => new Response(JSON.stringify(providerPayload(JSON.stringify({ focusTargetId: "unknown", note: "No." })))),
  }), (error) => error.code === "invalid_reflection" && error.telemetry.promptTokens === 420);
});

test("reflection requests honor the injected wall-clock pricing guard", async () => {
  const input = reflectionInput();
  let calls = 0;
  await assert.rejects(createDeepSeekReflection({
    ...input,
    policy: { mode: "accelerated", intervalDays: 24, residentIds: ["sal"] },
    env,
    wallClock: "2026-09-01T02:30:00.000Z",
    fetchImpl: async () => { calls += 1; return new Response("{}"); },
  }), (error) => error.code === "peak_pricing_window" && error.telemetry.skipped === true);
  assert.equal(calls, 0);
  assert.equal(typeof deepSeekReflectionAdapter({ env, bypassPeakPricing: true }), "function");
});

test("the staging reflection slice produces a healthy, consequential A/B comparison", async () => {
  let calls = 0;
  const report = await runReflectionComparison({
    days: 30,
    checkpoints: [1, 7, 30],
    reflectionAdapter: async (input) => {
      calls += 1;
      assert.equal(input.resident.id, "sal");
      return { focusTargetId: "june", note: "Make time for June.", source: "scripted" };
    },
  });
  assert.equal(calls, 2);
  assert.equal(report.baseline.healthy, true);
  assert.equal(report.assisted.healthy, true);
  assert.equal(report.baseline.reflections.count, 0);
  assert.equal(report.assisted.reflections.count, 2);
  assert.ok(report.divergence.focalEncounterDelta > 0);
  assert.ok(report.divergence.focalRelationshipStrengthDelta > 0);
});

test("the same A/B harness can inject the bounded DeepSeek adapter", async () => {
  let calls = 0;
  const report = await runReflectionComparison({
    days: 30,
    wallClock: "2026-09-01T00:30:00.000Z",
    reflectionAdapter: deepSeekReflectionAdapter({
      env,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(providerPayload(JSON.stringify({ focusTargetId: "june", note: "Make time for June." }))));
      },
    }),
  });
  assert.equal(calls, 2);
  assert.equal(report.assisted.reflections.modelCalls, 2);
  assert.equal(report.assisted.reflections.attempts, 2);
  assert.equal(report.assisted.reflections.promptTokens, 840);
  assert.equal(report.assisted.reflections.fallbacks, 0);
  assert.ok(report.estimatedCostUsd > 0);
});

test("reflection failures fall back without stopping the town", async () => {
  const report = await runReflectionComparison({ days: 1, reflectionAdapter: async () => { throw Object.assign(new Error("provider unavailable"), { code: "network_error" }); } });
  assert.equal(report.assisted.healthy, true);
  assert.equal(report.assisted.reflections.count, 1);
  assert.equal(report.assisted.reflections.fallbacks, 1);
  assert.equal(report.assisted.focalEncounterCount, 0);
});

test("reflection-enabled scenario chunks replay identically", async () => {
  const options = {
    days: 30,
    checkpoints: [1, 7, 30],
    seed: "reflection-chunk-replay",
    reflectionPolicy: { mode: "fast_test", intervalDays: 7, residentIds: ["sal"] },
    reflectionAdapter: async () => ({ focusTargetId: "june", note: "Make time for June.", source: "scripted" }),
  };
  const uninterrupted = await runScenario(options);
  const prepared = await createScenarioRun({ days: options.days, checkpoints: options.checkpoints, seed: options.seed });
  const first = await advanceScenarioRun(prepared, { ...options, throughDay: 7 });
  const chunked = scenarioRunResult(await advanceScenarioRun(first, { ...options, throughDay: 30 }));
  assert.equal(uninterrupted.final.healthy, true);
  assert.equal(chunked.final.healthy, true);
  assert.deepEqual(chunked.final, uninterrupted.final);
  assert.deepEqual(chunked.checkpoints, uninterrupted.checkpoints);
});

test("reflection prompts are available as a standalone bounded message builder", () => {
  const { state, resident, now } = reflectionInput();
  const messages = buildReflectionMessages({ state, resident, now, policy: { mode: "fast_test", intervalDays: 7 } });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /exactly one related resident/);
  assert.match(messages[1].content, /legalFocusTargets/);
});
