import test from "node:test";
import assert from "node:assert/strict";

import { waitForModelEvaluation } from "../scripts/wait-model-evaluation.mjs";

const revision = "evaluation-test";

function response(report) {
  return new Response(JSON.stringify(report), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("the post-deploy check waits for the bounded evaluation report", async () => {
  const reports = [
    { revision, status: "pending" },
    { revision, status: "running" },
    { revision, status: "complete", calls: 24, fallbackCount: 0 },
  ];
  let clock = 0;
  const result = await waitForModelEvaluation({
    url: "https://staging.example",
    revision,
    fetchImpl: async () => response(reports.shift()),
    sleepImpl: async (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    timeoutMs: 1_000,
    pollMs: 10,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.calls, 24);
  assert.equal(clock, 20);
});

test("the post-deploy check fails loudly on a terminal evaluation error", async () => {
  await assert.rejects(
    waitForModelEvaluation({
      url: "https://staging.example",
      revision,
      fetchImpl: async () => response({ revision, status: "failed", error: "ProviderError" }),
    }),
    /ProviderError/,
  );
});
