import test from "node:test";
import assert from "node:assert/strict";

import { createInitialTown } from "../src/simulation.js";
import {
  createDeepSeekPlan,
  DeepSeekPlannerError,
} from "../src/deepseek-planner.js";

const env = { DEEPSEEK_API_KEY: "test-key" };

function fixtureContent(overrides = {}) {
  return JSON.stringify({
    obligationId: "obligation-sal-vey-notice",
    choice: "fulfill",
    note: "The direct route is still possible.",
    ...overrides,
  });
}

function payload(content, overrides = {}) {
  return {
    id: "chatcmpl-calder-test",
    model: "deepseek-v4-flash",
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content },
    }],
    usage: {
      prompt_tokens: 420,
      completion_tokens: 96,
      total_tokens: 516,
      prompt_cache_hit_tokens: 120,
      prompt_cache_miss_tokens: 300,
    },
    ...overrides,
  };
}

function modelInput() {
  const town = createInitialTown();
  const resident = town.residents.find(({ id }) => id === "sal");
  const now = new Date(resident.nextDecisionAt);
  const obligation = town.obligations.find(({ ownerId, status }) => ownerId === resident.id && status === "open");
  return { state: town, resident, now, obligation };
}

test("the DeepSeek adapter sends a bounded JSON decision request", async () => {
  const input = modelInput();
  let request;
  const plan = await createDeepSeekPlan({
    ...input,
    env,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify(payload(fixtureContent())), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const body = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.init.headers.authorization, "Bearer test-key");
  assert.equal(body.response_format.type, "json_object");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 120);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages[1].content.includes("test-key"), false);
  assert.equal(body.messages[0].content.includes("Calder Station"), true);
  assert.equal(body.messages[1].content.includes("Sal D’Amico"), true);
  assert.equal(body.messages[1].content.includes("Rookwood"), false);
  assert.equal(plan.source, "model");
  assert.equal(plan.actions[0].action, "deliver");
  assert.ok(plan.actions.length > 1);
  assert.ok(plan.actions.some(({ action }) => action === "rest"));
  assert.equal(plan.obligationDecision.choice, "fulfill");
  assert.equal(plan.modelTelemetry.promptTokens, 420);
  assert.equal(plan.modelTelemetry.completionTokens, 96);
  assert.equal(plan.modelTelemetry.promptCacheHitTokens, 120);
  assert.equal(plan.modelTelemetry.promptCacheMissTokens, 300);
  assert.equal(plan.modelTelemetry.requestId, "chatcmpl-calder-test");
});

test("the model may choose an outcome but may not author world actions", async () => {
  const input = modelInput();
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      fetchImpl: async () => new Response(JSON.stringify(payload(fixtureContent({
        action: "deliver",
      })))),
    }),
    (error) => error.code === "invalid_choice_shape",
  );
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      fetchImpl: async () => new Response(JSON.stringify(payload(fixtureContent({
        obligationId: "stale-obligation",
      })))),
    }),
    (error) => error.code === "stale_obligation",
  );
});

test("provider errors become typed failures for the deterministic fallback", async () => {
  const input = modelInput();
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 }),
    }),
    (error) => error instanceof DeepSeekPlannerError && error.code === "http_429",
  );
});

test("truncated and malformed model responses never cross the plan boundary", async () => {
  const input = modelInput();
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      fetchImpl: async () => new Response(JSON.stringify(payload(fixtureContent(), {
        choices: [{ finish_reason: "length", message: { content: fixtureContent() } }],
      }))),
    }),
    (error) => error.code === "truncated_response" && error.telemetry.promptTokens === 420,
  );
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      fetchImpl: async () => new Response(JSON.stringify(payload("not-json"))),
    }),
    (error) => error.code === "invalid_json" && error.telemetry.totalTokens === 516,
  );
});

test("a slow provider request is cut off once", async () => {
  const input = modelInput();
  await assert.rejects(
    createDeepSeekPlan({
      ...input,
      env,
      timeoutMs: 1,
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    (error) => error.code === "timeout",
  );
});
