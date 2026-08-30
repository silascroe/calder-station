import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateDeepSeekCost,
  modelEvaluationScenarioCount,
  runModelEvaluation,
} from "../src/model-evaluation.js";

function modelResponse(body, index) {
  const prompt = body.messages.at(-1).content;
  const context = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
  const selected = [...context.legalChoices].sort((left, right) => (
    (right.consequences.currentRelationship.strength ?? 0)
      - (left.consequences.currentRelationship.strength ?? 0)
    || left.consequences.dueInMinutes - right.consequences.dueInMinutes
  ))[0];
  return {
    id: `chatcmpl-evaluation-${index}`,
    model: "deepseek-v4-flash",
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          obligationId: selected.obligationId,
          choice: selected.choice,
          note: "This commitment has the stronger immediate claim.",
        }),
      },
    }],
    usage: {
      prompt_tokens: 500,
      completion_tokens: 70,
      total_tokens: 570,
      prompt_cache_hit_tokens: 100,
      prompt_cache_miss_tokens: 400,
    },
  };
}

test("paid evaluation exercises varied cases through the authoritative engine", async () => {
  let calls = 0;
  const report = await runModelEvaluation({
    env: { DEEPSEEK_API_KEY: "test-key" },
    repetitions: 1,
    concurrency: 2,
    wallClock: new Date("2026-08-31T00:30:00.000Z"),
    fetchImpl: async (_url, init) => {
      calls += 1;
      return new Response(JSON.stringify(modelResponse(JSON.parse(init.body), calls)));
    },
  });

  assert.equal(calls, modelEvaluationScenarioCount(1));
  assert.equal(report.status, "complete");
  assert.equal(report.calls, 8);
  assert.equal(report.successfulModelPlans, 8);
  assert.equal(report.fallbackCount, 0);
  assert.deepEqual(report.choices, { fulfill: 8 });
  assert.equal(report.promptTokens, 4_000);
  assert.equal(report.completionTokens, 560);
  assert.ok(report.estimatedCostUsd > 0);
  assert.ok(report.cases.every(({ competingObligationCount }) => competingObligationCount === 2));
  assert.ok(report.cases.some(({ selectedObligationId }) => selectedObligationId === "evaluation-route-report"));
  assert.ok(report.cases.some(({ selectedObligationId }) => selectedObligationId === "obligation-sal-vey-notice"));
  const competing = report.cases.find(({ selectedObligationId }) => selectedObligationId === "evaluation-route-report");
  assert.equal(competing.competingObligationCount, 2);
  assert.equal(competing.selectedObligationId, "evaluation-route-report");
  assert.equal(competing.executedOutcome, "fulfilled");
  assert.equal(competing.primaryOutcome, "broken");
  assert.ok(report.cases.every(({ primaryOutcome, competingOutcome }) => (
    [primaryOutcome, competingOutcome].filter((status) => status === "fulfilled").length === 1
    && [primaryOutcome, competingOutcome].filter((status) => status === "broken").length === 1
  )));
  assert.ok(report.cases.every(({ source }) => source === "model"));
});

test("cost estimates use the injected peak schedule and reported cache split", () => {
  const usage = {
    promptTokens: 1_000,
    completionTokens: 100,
    promptCacheHitTokens: 600,
    promptCacheMissTokens: 400,
  };
  const offPeak = estimateDeepSeekCost(usage, "2026-08-31T00:30:00.000Z");
  const peak = estimateDeepSeekCost(usage, "2026-08-31T02:30:00.000Z");
  assert.equal(peak, offPeak * 2);
});
