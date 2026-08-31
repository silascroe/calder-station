import { fileURLToPath } from "node:url";

import { MODEL_EVALUATION_REVISION } from "../src/model-evaluation.js";

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_POLL_MS = 15 * 1000;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readReport(url, fetchImpl) {
  const endpoint = new URL("/api/evaluation", url);
  const response = await fetchImpl(endpoint, { headers: { "cache-control": "no-cache" } });
  const text = await response.text();
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error(`Evaluation endpoint returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Evaluation endpoint returned HTTP ${response.status}: ${report.error ?? "unknown error"}`);
  }
  return report;
}

export async function waitForModelEvaluation({
  url,
  revision = MODEL_EVALUATION_REVISION,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  if (!url) throw new TypeError("A staging deployment URL is required");
  const deadline = now() + timeoutMs;

  while (now() <= deadline) {
    const report = await readReport(url, fetchImpl);
    if (report.revision !== revision) {
      throw new Error(`Evaluation revision was ${report.revision ?? "missing"}; expected ${revision}`);
    }
    if (report.status === "complete") return report;
    if (["failed", "blocked-missing-key"].includes(report.status)) {
      throw new Error(`Evaluation ended with status ${report.status}${report.error ? ` (${report.error})` : ""}`);
    }
    if (!["pending", "baseline-running", "baseline-complete", "assisted-running"].includes(report.status)) {
      throw new Error(`Evaluation returned unsupported status ${report.status ?? "missing"}`);
    }
    await sleepImpl(pollMs);
  }
  throw new Error(`Evaluation ${revision} did not complete within ${timeoutMs}ms`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = argument("url");
  if (!url) throw new Error("Usage: wait-model-evaluation.mjs --url URL");
  const report = await waitForModelEvaluation({ url });
  console.log(`Model evaluation complete: ${report.calls} calls / ${report.fallbackCount} fallbacks / $${report.estimatedCostUsd.toFixed(6)}`);
  console.log(`MODEL_EVALUATION_REPORT=${JSON.stringify(report)}`);
}
