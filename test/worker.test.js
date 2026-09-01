import test from "node:test";
import assert from "node:assert/strict";

import worker, { runScheduledModelEvaluation } from "../src/worker.js";

function assets() {
  return {
    fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`),
  };
}

test("health endpoint reports the deterministic simulation Worker", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/health"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "town-dashboard");
  assert.equal(body.environment, "preview");
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.engine, "deterministic-scripted");
  assert.equal(body.persistence, "ephemeral");
  assert.equal(body.modelCalls, 0);
});

test("town endpoint exposes the replayable fifteen-resident simulation", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.name, "Calder Station");
  assert.equal(body.residents.length, 15);
  assert.equal(body.locations.length, 14);
  assert.equal(body.relationships.length, 27);
  assert.equal(body.mode, "scripted-simulation-preview");
  assert.equal(body.stats.tickCount, 24);
  assert.equal(body.stats.decisionCount, 15);
  assert.ok(body.stats.actionCount > body.stats.planCount);
  assert.equal("events" in body, false);
});

test("events endpoint returns newest events and page routes delegate to assets", async () => {
  const environment = { ASSETS: assets() };
  const eventsResponse = await worker.fetch(new Request("https://town.example/api/events"), environment);
  const missing = await worker.fetch(new Request("https://town.example/api/nope"), environment);
  const page = await worker.fetch(new Request("https://town.example/map"), environment);
  const eventsBody = await eventsResponse.json();

  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsBody.events[0].type, "decision");
  assert.ok(eventsBody.events.length > 80);
  assert.equal(eventsBody.events.at(-1).type, "system");
  assert.equal(missing.status, 404);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "asset:/map");
});

test("the read-only API rejects mutations", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town", { method: "POST" }),
    { ASSETS: assets() },
  );

  assert.equal(response.status, 405);
});

test("preview ticks can be changed without making the API mutable", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=0"),
    { ASSETS: assets() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.now, "2026-08-31T00:00:00.000Z");
  assert.equal(body.name, "Calder Station");
  assert.equal(body.stats.tickCount, 0);
  assert.equal(body.stats.decisionCount, 0);
});

test("invalid preview ticks return a client error", async () => {
  const response = await worker.fetch(
    new Request("https://town.example/api/town?ticks=999"),
    { ASSETS: assets() },
  );

  assert.equal(response.status, 400);
});

test("event limits are validated and applied", async () => {
  const environment = { ASSETS: assets() };
  const limited = await worker.fetch(new Request("https://town.example/api/events?limit=3"), environment);
  const invalid = await worker.fetch(new Request("https://town.example/api/events?limit=0"), environment);

  assert.equal((await limited.json()).events.length, 3);
  assert.equal(invalid.status, 400);
});

test("staging exposes a read-only evaluation report without a public trigger", async () => {
  const report = { revision: "evaluation-test", status: "complete", calls: 24 };
  const stub = { fetch: async () => new Response(JSON.stringify(report)) };
  const env = {
    TOWN_ENV: "staging",
    TOWN: { getByName: () => stub },
    ASSETS: assets(),
  };
  const response = await worker.fetch(new Request("https://town.example/api/evaluation"), env);
  const mutation = await worker.fetch(new Request("https://town.example/api/evaluation", { method: "POST" }), env);

  assert.deepEqual(await response.json(), report);
  assert.equal(mutation.status, 405);
});

test("the scheduled evaluator never automatically repeats a terminal revision", async () => {
  for (const status of ["complete", "failed"]) {
    let reads = 0;
    const report = { revision: "evaluation-test", status, calls: 24 };
    const env = {
      TOWN_ENV: "staging",
      MODEL_EVALUATION_REVISION: "evaluation-test",
      DEEPSEEK_API_KEY: "test-key",
      TOWN: {
        getByName: () => ({
          fetch: async (request) => {
            if (new URL(request.url).pathname === "/evaluation-run-meta") {
              return new Response("null");
            }
            reads += 1;
            return new Response(JSON.stringify(report));
          },
        }),
      },
    };

    assert.deepEqual(await runScheduledModelEvaluation(env), report);
    assert.equal(reads, 1);
  }
  assert.deepEqual(await runScheduledModelEvaluation({ TOWN_ENV: "production" }), { status: "skipped-non-staging" });
});

test("the scheduled evaluator terminalizes an assisted revision with no replay snapshot", async () => {
  let current = {
    revision: "evaluation-test",
    status: "assisted-running",
    phase: "model-assisted-season",
    paidCallsAtRisk: 1,
  };
  let writes = 0;
  const stub = {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/evaluation-run-meta") return new Response("null");
      if (request.method === "POST") {
        current = await request.json();
        writes += 1;
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(current));
    },
  };
  const env = {
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
    DEEPSEEK_API_KEY: "test-key",
    TOWN: { getByName: () => stub },
  };

  const failed = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "assisted-snapshot-missing");
  assert.equal(failed.paidCallsAtRisk, 1);
  assert.equal(writes, 1);

  const terminal = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-09-01T00:15:00.000Z"),
  });
  assert.deepEqual(terminal, failed);
  assert.equal(writes, 1);
});

function seasonResult({ selectedObligationId, calls = 0 } = {}) {
  return {
    healthy: true,
    events: 100,
    obligations: { fulfilled: 3, broken: 1 },
    relationships: {
      jamieSal: { strength: 60 },
      amosSal: { strength: 50 },
    },
    model: {
      calls,
      attempts: calls,
      fallbacks: 0,
      promptTokens: calls * 400,
      completionTokens: calls * 40,
    },
    selectedObligationId,
  };
}

function evaluationDependencies({ maxProgress = Infinity, onStep = () => {} } = {}) {
  let activePhase = null;
  let completedDays = 0;
  return {
    stepRunner: async (_stub, { phase, days }) => {
      if (phase !== activePhase) {
        activePhase = phase;
        completedDays = 0;
      }
      completedDays = Math.min(days, completedDays + maxProgress);
      const complete = completedDays >= days;
      onStep({ phase, completedDays, complete, days });
      return {
        completedDays,
        complete,
        result: complete ? seasonResult({
          selectedObligationId: phase === "assisted"
        ? "evaluation-season-route-report"
        : "obligation-sal-vey-notice",
          calls: phase === "assisted" ? 1 : 0,
        }) : null,
      };
    },
  };
}

test("the scheduled evaluator checkpoints the free baseline before leasing one paid season call", async () => {
  const writes = [];
  let current = { revision: "older-evaluation", status: "complete" };
  let currentRun = null;
  const stub = {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/evaluation-run" && request.method === "DELETE") {
        currentRun = null;
        return new Response(JSON.stringify({ ok: true }));
      }
      if (pathname === "/evaluation-run-meta") {
        if (request.method === "POST") {
          currentRun = (await request.json()).run;
          return new Response(JSON.stringify({ ok: true }));
        }
        if (request.method === "DELETE") {
          currentRun = null;
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify(currentRun));
      }
      if (request.method === "POST") {
        current = await request.json();
        writes.push(current);
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(current));
    },
  };
  const env = {
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
    DEEPSEEK_API_KEY: "test-key",
    TOWN: { getByName: () => stub },
  };
  const checkpoint = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:00:00.000Z"),
    days: 7,
    ...evaluationDependencies({
      onStep: ({ phase, completedDays, complete, days }) => {
        currentRun = complete ? null : {
          kind: "calder-station-scenario-run",
          evaluationPhase: phase,
          completedDays,
          days,
        };
      },
    }),
  });
  assert.equal(checkpoint.status, "baseline-complete");
  assert.equal(checkpoint.baseline.selectedObligationId, "obligation-sal-vey-notice");
  assert.equal(currentRun, null);
  assert.deepEqual(writes.map(({ status }) => status), ["baseline-running", "baseline-complete"]);

  const report = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:15:00.000Z"),
    days: 7,
    ...evaluationDependencies(),
  });

  assert.deepEqual(writes.map(({ status }) => status), [
    "baseline-running",
    "baseline-complete",
    "assisted-running",
    "complete",
  ]);
  assert.equal(writes.at(-1).status, "complete");
  assert.equal(report.calls, 1);
  assert.equal(report.matrixCalls, 0);
  assert.equal(report.longHorizon.baseline.selectedObligationId, "obligation-sal-vey-notice");
  assert.equal(report.longHorizon.assisted.selectedObligationId, "evaluation-season-route-report");
  assert.equal(currentRun, null);
});

test("an in-progress season resumes from its persisted chunk without another paid start", async () => {
  let current = { revision: "older-evaluation", status: "complete" };
  let currentRun = null;
  const writes = [];
  const stub = {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/evaluation-run-meta") {
        if (request.method === "POST") {
          currentRun = (await request.json()).run;
          return new Response(JSON.stringify({ ok: true }));
        }
        if (request.method === "DELETE") {
          currentRun = null;
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify(currentRun));
      }
      if (request.method === "POST") {
        current = await request.json();
        writes.push(current);
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(current));
    },
  };
  const env = {
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
    DEEPSEEK_API_KEY: "test-key",
    TOWN: { getByName: () => stub },
  };
  const dependencies = evaluationDependencies({
    maxProgress: 1,
    onStep: ({ phase, completedDays, complete, days }) => {
      currentRun = complete ? null : {
        kind: "calder-station-scenario-run",
        evaluationPhase: phase,
        completedDays,
        days,
      };
    },
  });

  const first = await runScheduledModelEvaluation(env, {
    days: 14,
    ...dependencies,
  });
  assert.equal(first.status, "baseline-running");
  assert.equal(first.completedDays, 13);
  assert.equal(currentRun.completedDays, 13);

  const second = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:15:00.000Z"),
    days: 14,
    ...dependencies,
  });
  assert.equal(second.status, "baseline-complete");
  assert.equal(currentRun, null);

  const third = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:30:00.000Z"),
    days: 14,
    ...dependencies,
  });
  assert.equal(third.status, "assisted-running");
  assert.equal(third.completedDays, 13);

  const fourth = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:45:00.000Z"),
    days: 14,
    ...dependencies,
  });
  assert.equal(fourth.status, "complete");
  assert.equal(fourth.calls, 1);
  assert.equal(currentRun, null);
  assert.deepEqual(writes.map(({ status }) => status), [
    "baseline-running",
    "baseline-running",
    "baseline-running",
    "baseline-complete",
    "assisted-running",
    "assisted-running",
    "complete",
  ]);
});

test("an expired free baseline lease may retry without risking a duplicate provider call", async () => {
  let current = {
    revision: "evaluation-test",
    status: "baseline-running",
    startedAt: "2026-08-31T00:00:00.000Z",
  };
  let currentRun = null;
  let baselineSteps = 0;
  const stub = {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/evaluation-run-meta") {
        if (request.method === "POST") {
          currentRun = await request.json();
          return new Response(JSON.stringify({ ok: true }));
        }
        if (request.method === "DELETE") {
          currentRun = null;
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify(currentRun));
      }
      if (request.method === "POST") {
        current = await request.json();
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify(current));
    },
  };
  const env = {
    TOWN_ENV: "staging",
    MODEL_EVALUATION_REVISION: "evaluation-test",
    DEEPSEEK_API_KEY: "test-key",
    TOWN: { getByName: () => stub },
  };

  const fresh = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:10:00.000Z"),
    days: 7,
    ...evaluationDependencies(),
  });
  assert.equal(fresh.status, "baseline-running");
  assert.equal(baselineSteps, 0);

  const recovered = await runScheduledModelEvaluation(env, {
    wallClock: new Date("2026-08-31T00:25:00.000Z"),
    days: 7,
    stepRunner: async (_stub, { phase, days }) => {
      baselineSteps += 1;
      assert.equal(phase, "baseline");
      return {
        completedDays: days,
        complete: true,
        result: seasonResult({ selectedObligationId: "obligation-sal-vey-notice" }),
      };
    },
  });
  assert.equal(recovered.status, "baseline-complete");
  assert.equal(baselineSteps, 1);
});
