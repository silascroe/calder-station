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
} from "./model-evaluation.js";
import { DEFAULT_DEEPSEEK_MODEL } from "./deepseek-planner.js";

export { RookwoodTown };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const BASELINE_LEASE_MS = 20 * 60 * 1000;
const EVALUATION_CHUNK_DAYS = 7;
const MAX_EVALUATION_CHUNKS_PER_INVOCATION = 13;

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

async function readEvaluationRunMeta(stub) {
  const response = await stub.fetch(new Request("https://town.internal/evaluation-run-meta"));
  if (!response.ok) throw new Error(`Could not read model evaluation run: HTTP ${response.status}`);
  const meta = await response.json();
  return meta?.kind === "calder-station-scenario-run" && meta.evaluationPhase
    ? meta
    : null;
}

async function requestEvaluationStep(stub, { revision, phase, days, wallClock }) {
  const response = await stub.fetch(new Request("https://town.internal/evaluation-step", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      revision,
      phase,
      days,
      chunkDays: EVALUATION_CHUNK_DAYS,
      wallClock: new Date(wallClock).toISOString(),
    }),
  }));
  const payload = await response.json();
  if (!response.ok) throw new Error(`Could not advance model evaluation run: HTTP ${response.status}`);
  return payload;
}

async function deleteEvaluationRun(stub) {
  const response = await stub.fetch(new Request("https://town.internal/evaluation-run", {
    method: "DELETE",
  }));
  if (!response.ok) throw new Error(`Could not delete model evaluation run: HTTP ${response.status}`);
}

function progressReport({ revision, status, phase, startedAt, completedDays, days, paidCallsAtRisk, checkedAt }) {
  return {
    kind: "calder-station-model-evaluation",
    revision,
    status,
    phase,
    startedAt,
    checkedAt,
    completedDays,
    totalDays: days,
    paidCallsAtRisk,
  };
}

async function advanceEvaluationRun({
  stub,
  revision,
  phase,
  env,
  wallClock,
  days,
  stepRunner = requestEvaluationStep,
}) {
  let progress = null;
  let chunks = 0;
  while (chunks < MAX_EVALUATION_CHUNKS_PER_INVOCATION) {
    progress = await stepRunner(stub, {
      revision,
      phase,
      days,
      env,
      wallClock,
    });
    chunks += 1;
    if (progress.complete) break;
  }
  return {
    completedDays: progress?.completedDays ?? 0,
    result: progress?.complete ? progress.result : null,
  };
}

export async function runScheduledModelEvaluation(env, {
  wallClock = new Date(),
  days = 90,
  stepRunner = requestEvaluationStep,
} = {}) {
  if (env?.TOWN_ENV !== "staging") return { status: "skipped-non-staging" };
  if (!persistentBindingReady(env)) throw new Error("Staging model evaluation requires the TOWN binding");
  const revision = env.MODEL_EVALUATION_REVISION ?? MODEL_EVALUATION_REVISION;
  const stub = env.TOWN.getByName(townStorageKey(env));
  const currentResponse = await stub.fetch(new Request("https://town.internal/evaluation"));
  if (!currentResponse.ok) throw new Error(`Could not read model evaluation: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  if (current.revision === revision && ["complete", "failed"].includes(current.status)) return current;
  const runMeta = await readEvaluationRunMeta(stub);
  if (current.revision === revision && current.status === "assisted-running" && !runMeta) {
    // The assisted phase is paid work. If its replay snapshot is absent, the
    // previous invocation may have spent a request before it was persisted.
    // Do not retry blindly; make the revision terminal and require a new
    // explicit evaluation revision before spending again.
    const failed = {
      ...current,
      status: "failed",
      phase: "model-assisted-season",
      checkedAt: new Date(wallClock).toISOString(),
      error: "assisted-snapshot-missing",
      paidCallsAtRisk: 1,
    };
    await storeEvaluation(stub, failed);
    return failed;
  }
  if (current.revision === revision && current.status === "baseline-running" && !runMeta) {
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
  const baselineInProgress = current.revision === revision
    && current.status === "baseline-running"
    && runMeta?.evaluationPhase === "baseline";
  const baselineLeaseExpired = current.revision === revision
    && current.status === "baseline-running"
    && !runMeta
    && (!Number.isFinite(new Date(wallClock).getTime() - new Date(current.startedAt).getTime())
      || new Date(wallClock).getTime() - new Date(current.startedAt).getTime() >= BASELINE_LEASE_MS);
  if (baselineInProgress || baselineLeaseExpired || current.revision !== revision || current.status === "pending" || current.status === "blocked-missing-key") {
    const startedAt = current.revision === revision ? current.startedAt ?? checkedAt : checkedAt;
    await storeEvaluation(stub, progressReport({
      revision,
      status: "baseline-running",
      phase: "scripted-baseline",
      startedAt,
      checkedAt,
      completedDays: baselineInProgress ? runMeta.completedDays : 0,
      days,
      paidCallsAtRisk: 0,
    }));
    try {
      const progressed = await advanceEvaluationRun({
        stub,
        revision,
        phase: "baseline",
        env,
        wallClock,
        days,
        stepRunner,
      });
      if (!progressed.result) {
        const progress = progressReport({
          revision,
          status: "baseline-running",
          phase: "scripted-baseline",
          startedAt,
          checkedAt,
          completedDays: progressed.completedDays,
          days,
          paidCallsAtRisk: 0,
        });
        await storeEvaluation(stub, progress);
        return progress;
      }
      await deleteEvaluationRun(stub);
      const checkpoint = {
        ...progressReport({
          revision,
          status: "baseline-complete",
          phase: "awaiting-model-season",
          startedAt,
          checkedAt,
          completedDays: days,
          days,
          paidCallsAtRisk: 0,
        }),
        baseline: progressed.result,
      };
      await storeEvaluation(stub, checkpoint);
      return checkpoint;
    } catch (error) {
      await deleteEvaluationRun(stub);
      const failed = {
        ...progressReport({
          revision,
          status: "failed",
          phase: "scripted-baseline",
          startedAt,
          checkedAt,
          completedDays: 0,
          days,
          paidCallsAtRisk: 0,
        }),
        error: error?.name ?? "EvaluationError",
      };
      await storeEvaluation(stub, failed);
      return failed;
    }
  }

  const startedAt = current.startedAt ?? current.checkedAt ?? checkedAt;
  if (current.status === "baseline-complete") {
    await deleteEvaluationRun(stub);
    await storeEvaluation(stub, {
      ...current,
      status: "assisted-running",
      phase: "model-assisted-season",
      assistedStartedAt: checkedAt,
      paidCallsAtRisk: 1,
      completedDays: 0,
    });
  }

  try {
    const progressed = await advanceEvaluationRun({
      stub,
      revision,
      phase: "assisted",
      env,
      wallClock,
      days,
      stepRunner,
    });
    if (!progressed.result) {
      const progress = {
        ...current,
        status: "assisted-running",
        phase: "model-assisted-season",
        assistedStartedAt: current.assistedStartedAt ?? checkedAt,
        checkedAt,
        completedDays: progressed.completedDays,
        totalDays: days,
        paidCallsAtRisk: 1,
      };
      await storeEvaluation(stub, progress);
      return progress;
    }
    const assisted = progressed.result;
    const longHorizon = combineModelSeasonResults({ baseline: current.baseline, assisted, wallClock, days });
    const model = assisted.model ?? {};
    const calls = Number(model.attempts ?? 0);
    const fallbackCount = Number(model.fallbacks ?? 0);
    const report = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "complete",
      requestedAt: startedAt,
      completedAt: checkedAt,
      model: env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
      calls,
      matrixCalls: 0,
      successfulModelPlans: Number(model.calls ?? 0),
      fallbackCount,
      fallbackRate: calls === 0 ? 0 : fallbackCount / calls,
      modelCostSkips: Number(model.costSkips ?? 0),
      choices: assisted.selectedObligationId ? { [assisted.selectedObligationId]: 1 } : {},
      promptTokens: Number(model.promptTokens ?? 0),
      completionTokens: Number(model.completionTokens ?? 0),
      estimatedCostUsd: longHorizon.estimatedCostUsd,
      longHorizon,
    };
    await deleteEvaluationRun(stub);
    await storeEvaluation(stub, report);
    return report;
  } catch (error) {
    await deleteEvaluationRun(stub);
    const failed = {
      kind: "calder-station-model-evaluation",
      revision,
      status: "failed",
      phase: "model-assisted-season",
      checkedAt,
      error: error?.name ?? "EvaluationError",
    };
    await storeEvaluation(stub, failed);
    return failed;
  }
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
