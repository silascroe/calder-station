import {
  eventView,
  previewOptions,
  runPreview,
  townView,
} from "./simulation.js";
import { RookwoodTown, townStorageKey } from "./town-do.js";
import {
  combineModelSeasonResults,
  MODEL_EVALUATION_REVISION,
  runModelSeasonAssisted,
  runModelSeasonBaseline,
} from "./model-evaluation.js";
import { DEFAULT_DEEPSEEK_MODEL } from "./deepseek-planner.js";

export { RookwoodTown };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const BASELINE_LEASE_MS = 20 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed() {
  return json({ error: "Only GET is supported by the read-only API." }, 405);
}

async function previewFromUrl(url) {
  return runPreview(previewOptions(url));
}

function explicitPreview(url) {
  return url.searchParams.has("ticks") || url.searchParams.get("preview") === "1";
}

function persistentBindingReady(env) {
  return typeof env?.TOWN?.getByName === "function";
}

function configuredEnvironment(env) {
  if (env?.TOWN_ENV === "production" || env?.TOWN_ENV === "staging") return env.TOWN_ENV;
  return null;
}

function persistenceConfigurationError(url, env) {
  if (explicitPreview(url) || persistentBindingReady(env)) return null;
  const environment = configuredEnvironment(env);
  if (!environment) return null;
  return json({
    ok: false,
    error: `The ${environment} Worker is missing its required TOWN Durable Object binding.`,
    service: "town-dashboard",
    environment,
    persistence: "misconfigured",
    expectedBinding: "TOWN",
  }, 503);
}

function shouldUsePersistentTown(url, env) {
  return persistentBindingReady(env) && !explicitPreview(url);
}

function persistentRequest(url, path) {
  const target = new URL(url);
  target.pathname = path;
  for (const key of [...target.searchParams.keys()]) {
    if (key !== "limit") target.searchParams.delete(key);
  }
  return new Request(target, { method: "GET" });
}

async function persistentApi(env, url, path) {
  const stub = env.TOWN.getByName(townStorageKey(env));
  return stub.fetch(persistentRequest(url, path));
}

async function storeEvaluation(stub, report) {
  const response = await stub.fetch(new Request("https://town.internal/evaluation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  }));
  if (!response.ok) throw new Error(`Could not persist model evaluation: HTTP ${response.status}`);
}

export async function runScheduledModelEvaluation(env, {
  wallClock = new Date(),
  days = 90,
  baselineRunner = runModelSeasonBaseline,
  assistedRunner = runModelSeasonAssisted,
} = {}) {
  if (env?.TOWN_ENV !== "staging") return { status: "skipped-non-staging" };
  if (!persistentBindingReady(env)) throw new Error("Staging model evaluation requires the TOWN binding");
  const revision = env.MODEL_EVALUATION_REVISION ?? MODEL_EVALUATION_REVISION;
  const stub = env.TOWN.getByName(townStorageKey(env));
  const currentResponse = await stub.fetch(new Request("https://town.internal/evaluation"));
  if (!currentResponse.ok) throw new Error(`Could not read model evaluation: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  if (current.revision === revision && ["complete", "failed", "assisted-running"].includes(current.status)) return current;
  if (current.revision === revision && current.status === "baseline-running") {
    const leaseAge = new Date(wallClock).getTime() - new Date(current.startedAt).getTime();
    if (Number.isFinite(leaseAge) && leaseAge < BASELINE_LEASE_MS) return current;
  }

  if (!env.DEEPSEEK_API_KEY) {
    const blocked = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "blocked-missing-key",
      checkedAt: new Date(wallClock).toISOString(),
    };
    await storeEvaluation(stub, blocked);
    return blocked;
  }

  const checkedAt = new Date(wallClock).toISOString();
  if (current.revision !== revision || current.status !== "baseline-complete") {
    await storeEvaluation(stub, {
      kind: "calder-station-model-evaluation",
      revision,
      status: "baseline-running",
      startedAt: checkedAt,
      phase: "scripted-baseline",
      paidCallsAtRisk: 0,
    });
    let baseline;
    try {
      baseline = await baselineRunner({ days });
    } catch (error) {
      const failed = {
        kind: "calder-station-model-evaluation",
        revision,
        status: "failed",
        phase: "scripted-baseline",
        checkedAt,
        error: error?.name ?? "EvaluationError",
      };
      await storeEvaluation(stub, failed);
      return failed;
    }
    const checkpoint = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "baseline-complete",
      phase: "awaiting-model-season",
      checkedAt,
      baseline,
    };
    await storeEvaluation(stub, checkpoint);
    return checkpoint;
  }

  await storeEvaluation(stub, {
    ...current,
    status: "assisted-running",
    phase: "model-assisted-season",
    assistedStartedAt: checkedAt,
    paidCallsAtRisk: 1,
  });

  let report;
  try {
    const assisted = await assistedRunner({
      env,
      fetchImpl: env?.DEEPSEEK_FETCH ?? globalThis.fetch,
      wallClock,
      days,
    });
    const longHorizon = combineModelSeasonResults({ baseline: current.baseline, assisted, wallClock, days });
    const model = assisted.model ?? {};
    const calls = Number(model.attempts ?? 0);
    const fallbackCount = Number(model.fallbacks ?? 0);
    report = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "complete",
      requestedAt: current.startedAt ?? current.checkedAt ?? checkedAt,
      completedAt: new Date().toISOString(),
      model: env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
      calls,
      matrixCalls: 0,
      successfulModelPlans: Number(model.calls ?? 0),
      fallbackCount,
      fallbackRate: calls === 0 ? 0 : fallbackCount / calls,
      choices: assisted.selectedObligationId ? { [assisted.selectedObligationId]: 1 } : {},
      promptTokens: Number(model.promptTokens ?? 0),
      completionTokens: Number(model.completionTokens ?? 0),
      estimatedCostUsd: longHorizon.estimatedCostUsd,
      longHorizon,
    };
  } catch (error) {
    report = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "failed",
      phase: "model-assisted-season",
      checkedAt,
      error: error?.name ?? "EvaluationError",
    };
  }
  await storeEvaluation(stub, report);
  return report;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return methodNotAllowed();

      if (["/api/health", "/api/town", "/api/events", "/api/evaluation"].includes(url.pathname)) {
        const configurationError = persistenceConfigurationError(url, env);
        if (configurationError) return configurationError;
      }

      try {
        if (url.pathname === "/api/health") {
          if (shouldUsePersistentTown(url, env)) {
            return await persistentApi(env, url, "/health");
          }

          const state = await previewFromUrl(url);
          return json({
            ok: true,
            service: "town-dashboard",
            environment: state.environment,
            mode: state.mode,
            engine: "deterministic-scripted",
            persistence: state.persistence,
            tickCount: state.stats.tickCount,
            modelCalls: state.stats.modelCalls,
            serverTime: new Date().toISOString(),
          });
        }

        if (url.pathname === "/api/town") {
          if (shouldUsePersistentTown(url, env)) {
            return await persistentApi(env, url, "/state");
          }

          return json(townView(await previewFromUrl(url)));
        }

        if (url.pathname === "/api/events") {
          if (shouldUsePersistentTown(url, env)) {
            return await persistentApi(env, url, "/events");
          }

          const state = await previewFromUrl(url);
          const rawLimit = url.searchParams.get("limit");
          const limit = rawLimit === null ? undefined : Number(rawLimit);
          if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 200)) {
            throw new RangeError("limit must be between 1 and 200");
          }
          return json({
            events: limit === undefined ? eventView(state) : eventView(state).slice(0, limit),
            tickCount: state.stats.tickCount,
            persistence: state.persistence,
          });
        }

        if (url.pathname === "/api/evaluation") {
          if (!shouldUsePersistentTown(url, env) || env?.TOWN_ENV !== "staging") {
            return json({ error: "Model evaluation reports are available only from persistent staging." }, 404);
          }
          return await persistentApi(env, url, "/evaluation");
        }

        return json({ error: "API route not found." }, 404);
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) {
          return json({ error: error.message }, 400);
        }
        throw error;
      }
    }

    if (!env?.ASSETS) {
      return new Response("Static asset binding is not configured.", { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    const work = runScheduledModelEvaluation(env);
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(work);
    else await work;
  },
};
