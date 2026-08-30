import {
  migrateLegacyEvent,
  TOWN_DISPLAY_NAME,
  TOWN_STORAGE_KEY,
  TOWN_WORLD_ID,
} from "./identity.js";
import { TOWN_SEED_REVISION } from "./demo-data.js";
import {
  advanceTown,
  createInitialTown,
  reconcileTownWithSeed,
  townView,
} from "./simulation.js";
import { planResidentDecision } from "./hybrid-planner.js";
import { scriptedObligationPlan } from "./obligations.js";

// Keep the exported name and production key stable. Renaming the public town
// must not strand the existing production Durable Object behind a new object
// name. The display identity lives in the state and authored seed instead.
export const TOWN_NAME = TOWN_WORLD_ID;
export const PRODUCTION_ENVIRONMENT = "production";
export const STAGING_ENVIRONMENT = "staging";
export const SIMULATION_STEP_MINUTES = 60;
export const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_EVENT_LIMIT = 80;
export const MAX_EVENT_LIMIT = 200;
const MODEL_EVALUATION_KEY_PREFIX = "model-evaluation:";
const MODEL_DECISION_KEY_PREFIX = "model-decision:";
const ALARM_ATTEMPT_KEY = "alarm-attempt";
const ALARM_FAILURE_KEY = "alarm-failure";

export function townEnvironment(env = {}) {
  return env.TOWN_ENV === STAGING_ENVIRONMENT
    ? STAGING_ENVIRONMENT
    : PRODUCTION_ENVIRONMENT;
}

export function townStorageKey(env = {}) {
  return townEnvironment(env) === STAGING_ENVIRONMENT
    ? `${TOWN_STORAGE_KEY}-staging`
    : TOWN_STORAGE_KEY;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS town_state (
    id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS town_events (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    event_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS town_events_at_idx ON town_events (at, id);
`;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function projectionFor(state) {
  const projection = clone(state);
  projection.events = [];
  return projection;
}

function modeFor(environment) {
  return environment === STAGING_ENVIRONMENT
    ? "staging-persistent-simulation"
    : "persistent-scripted-simulation";
}

function eventLimit(url) {
  const value = url.searchParams.get("limit");
  if (value === null || value === "") return DEFAULT_EVENT_LIMIT;
  if (!/^\d+$/.test(value)) throw new RangeError("limit must be a positive integer");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_LIMIT) {
    throw new RangeError(`limit must be between 1 and ${MAX_EVENT_LIMIT}`);
  }
  return limit;
}

function migrateStoredEvents(sql, previousSeedRevision) {
  if (previousSeedRevision >= TOWN_SEED_REVISION) return false;
  const rows = sql.exec("SELECT id, event_json FROM town_events").toArray();
  let changed = false;
  for (const row of rows) {
    const event = JSON.parse(row.event_json);
    const migrated = migrateLegacyEvent(event);
    if (JSON.stringify(migrated) === JSON.stringify(event)) continue;
    sql.exec(
      "UPDATE town_events SET event_json = ? WHERE id = ?",
      JSON.stringify(migrated),
      row.id,
    );
    changed = true;
  }
  return changed;
}

/** One serialized owner for the town projection, event log, and heartbeat. */
export class RookwoodTown {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.environment = townEnvironment(env);
    this.storageKey = townStorageKey(env);
    this.sql = ctx.storage.sql;

    const initialize = async () => this.sql.exec(SCHEMA);
    if (typeof ctx.blockConcurrencyWhile === "function") {
      ctx.blockConcurrencyWhile(initialize);
    } else {
      this.sql.exec(SCHEMA);
    }
  }

  persist(state) {
    const projection = JSON.stringify(projectionFor(state));
    const updatedAt = new Date().toISOString();
    const write = () => {
      this.sql.exec(
        `INSERT INTO town_state (id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
        this.storageKey,
        projection,
        updatedAt,
      );

      for (const event of state.events ?? []) {
        this.sql.exec(
          `INSERT OR IGNORE INTO town_events (id, at, event_json)
           VALUES (?, ?, ?)`,
          event.id,
          event.at,
          JSON.stringify(event),
        );
      }
    };

    if (typeof this.ctx.storage.transactionSync === "function") {
      this.ctx.storage.transactionSync(write);
    } else {
      write();
    }
  }

  async ensureAlarm() {
    const storage = this.ctx.storage;
    if (typeof storage.setAlarm !== "function") return null;
    if (typeof storage.getAlarm === "function") {
      const existing = await storage.getAlarm();
      if (existing !== null && existing !== undefined) return existing;
    }
    const nextAlarm = Date.now() + HEARTBEAT_INTERVAL_MS;
    await storage.setAlarm(nextAlarm);
    return nextAlarm;
  }

  evaluationRevision() {
    return this.environment === STAGING_ENVIRONMENT
      ? this.env?.MODEL_EVALUATION_REVISION ?? null
      : null;
  }

  async readEvaluation(revision = this.evaluationRevision()) {
    if (!revision || typeof this.ctx.storage.get !== "function") return null;
    return await this.ctx.storage.get(`${MODEL_EVALUATION_KEY_PREFIX}${revision}`) ?? null;
  }

  async writeEvaluation(report) {
    const revision = this.evaluationRevision();
    if (!revision || report?.revision !== revision) {
      throw new RangeError("Evaluation revision does not match the staging configuration");
    }
    if (typeof this.ctx.storage.put !== "function") {
      throw new TypeError("Durable Object storage cannot persist evaluation reports");
    }
    await this.ctx.storage.put(`${MODEL_EVALUATION_KEY_PREFIX}${revision}`, clone(report));
  }

  readEvents(limit = DEFAULT_EVENT_LIMIT) {
    return this.sql
      .exec(
        `SELECT event_json FROM town_events
         ORDER BY rowid DESC
         LIMIT ?`,
        limit,
      )
      .toArray()
      .map(({ event_json }) => JSON.parse(event_json));
  }

  latestEventSequence() {
    const rows = this.sql
      .exec("SELECT id FROM town_events ORDER BY rowid DESC LIMIT 1")
      .toArray();
    const match = /^event-(\d+)$/.exec(rows[0]?.id ?? "");
    return match ? Number(match[1]) : 0;
  }

  async load({ scheduleAlarm = true } = {}) {
    const rows = this.sql
      .exec("SELECT state_json FROM town_state WHERE id = ?", this.storageKey)
      .toArray();

    if (rows.length === 0) {
      const state = createInitialTown({ environment: this.environment });
      state.mode = modeFor(this.environment);
      state.persistence = "durable-object";
      state.summary = this.environment === STAGING_ENVIRONMENT
        ? "A disposable staging town for testing deterministic rules."
        : "A small town continuing under deterministic game-AI rules.";
      this.persist(state);
      if (scheduleAlarm) await this.ensureAlarm();
      return state;
    }

    const stored = JSON.parse(rows[0].state_json);
    const previousSeedRevision = Number(stored.seedRevision ?? 0);
    const historyChanged = migrateStoredEvents(this.sql, previousSeedRevision);
    const latestEventSequence = this.latestEventSequence();
    stored.stats ??= {};
    const storedEventCount = Number.isSafeInteger(stored.stats.eventCount)
      ? stored.stats.eventCount
      : 0;
    const eventSequenceChanged = storedEventCount < latestEventSequence;
    if (eventSequenceChanged) stored.stats.eventCount = latestEventSequence;

    // Keep only a small recent window in memory for the next decision. The
    // full history remains in SQLite and is never sent to the model.
    stored.events = this.readEvents(8).reverse();

    const reconciled = reconcileTownWithSeed(stored);
    const state = reconciled.state;
    let runtimeChanged = false;
    if (state.environment !== this.environment) {
      state.environment = this.environment;
      runtimeChanged = true;
    }
    if (state.mode !== modeFor(this.environment)) {
      state.mode = modeFor(this.environment);
      runtimeChanged = true;
    }
    if (state.persistence !== "durable-object") {
      state.persistence = "durable-object";
      runtimeChanged = true;
    }
    if (state.name !== TOWN_DISPLAY_NAME) {
      state.name = TOWN_DISPLAY_NAME;
      runtimeChanged = true;
    }

    if (reconciled.needsPersist || historyChanged || eventSequenceChanged || runtimeChanged) {
      this.persist(state);
    }

    if (scheduleAlarm) await this.ensureAlarm();
    return state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/evaluation") {
      if (this.environment !== STAGING_ENVIRONMENT) {
        return json({ error: "Model evaluation storage exists only in staging." }, 404);
      }
      try {
        const report = await request.json();
        await this.writeEvaluation(report);
        return json({ ok: true, revision: report.revision, status: report.status });
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError) {
          return json({ error: error.message }, 400);
        }
        throw error;
      }
    }

    if (request.method !== "GET") {
      return json({ error: "Only GET is supported by the town object." }, 405);
    }

    try {
      if (url.pathname === "/state") {
        return json(townView(await this.load()));
      }

      if (url.pathname === "/events") {
        const state = await this.load();
        return json({
          events: this.readEvents(eventLimit(url)),
          eventCount: state.stats.eventCount,
          tickCount: state.stats.tickCount,
          persistence: state.persistence,
          environment: state.environment,
        });
      }

      if (url.pathname === "/health") {
        const state = await this.load();
        const alarmAt = await this.ensureAlarm();
        const alarmFailure = typeof this.ctx.storage.get === "function"
          ? await this.ctx.storage.get(ALARM_FAILURE_KEY)
          : null;
        const evaluationRevision = this.evaluationRevision();
        const evaluation = await this.readEvaluation(evaluationRevision);
        return json({
          ok: true,
          service: "town-dashboard",
          name: state.name,
          environment: state.environment,
          mode: state.mode,
          engine: this.env?.DEEPSEEK_API_KEY ? "hybrid-scripted-deepseek" : "deterministic-scripted",
          modelReady: Boolean(this.env?.DEEPSEEK_API_KEY),
          persistence: state.persistence,
          object: this.storageKey,
          seedRevision: state.seedRevision,
          tickCount: state.stats.tickCount,
          eventCount: state.stats.eventCount,
          modelCalls: state.stats.modelCalls,
          modelAttempts: state.stats.modelAttempts,
          modelFallbacks: state.stats.modelFallbacks,
          modelCostSkips: state.stats.modelCostSkips,
          modelPromptTokens: state.stats.modelPromptTokens,
          modelCompletionTokens: state.stats.modelCompletionTokens,
          modelPromptCacheHitTokens: state.stats.modelPromptCacheHitTokens,
          modelPromptCacheMissTokens: state.stats.modelPromptCacheMissTokens,
          conflictedPlans: state.stats.conflictedPlanCount,
          evaluationRevision,
          evaluationStatus: evaluation?.status
            ?? (evaluationRevision && !this.env?.DEEPSEEK_API_KEY ? "blocked-missing-key" : evaluationRevision ? "pending" : null),
          clockPolicy: state.operations?.catchUpPolicy ?? "pause-on-downtime",
          simulationStepMinutes: SIMULATION_STEP_MINUTES,
          heartbeatIntervalMinutes: HEARTBEAT_INTERVAL_MS / (60 * 1000),
          lastHeartbeatAt: state.operations?.lastHeartbeatAt ?? null,
          lastHeartbeatRetryCount: state.operations?.lastHeartbeatRetryCount ?? 0,
          lastHeartbeatAdvancedFrom: state.operations?.lastHeartbeatAdvancedFrom ?? null,
          lastHeartbeatAdvancedTo: state.operations?.lastHeartbeatAdvancedTo ?? null,
          lastAlarmStatus: alarmFailure?.status === "failed" ? "failed" : "healthy",
          lastAlarmFailureAt: alarmFailure?.status === "failed" ? alarmFailure.failedAt : null,
          lastAlarmError: alarmFailure?.status === "failed" ? alarmFailure.error : null,
          alarmAt: alarmAt === null ? null : new Date(alarmAt).toISOString(),
          serverTime: new Date().toISOString(),
        });
      }

      if (url.pathname === "/evaluation") {
        if (this.environment !== STAGING_ENVIRONMENT) {
          return json({ error: "Model evaluation reports exist only in staging." }, 404);
        }
        const revision = this.evaluationRevision();
        const report = await this.readEvaluation(revision);
        return json(report ?? {
          kind: "calder-station-model-evaluation",
          revision,
          status: this.env?.DEEPSEEK_API_KEY ? "pending" : "blocked-missing-key",
        });
      }

      return json({ error: "Town object route not found." }, 404);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return json({ error: error.message }, 400);
      }
      throw error;
    }
  }

  async decisionPlanFor({ town, resident, now }, {
    wallClock = new Date(),
    bypassPeakPricing = false,
  } = {}) {
    const decisionKey = `${MODEL_DECISION_KEY_PREFIX}${resident.id}:${new Date(now).toISOString()}`;
    const storage = this.ctx.storage;
    const prior = typeof storage.get === "function" ? await storage.get(decisionKey) : null;
    if (prior?.status === "complete" && prior.plan) return clone(prior.plan);
    if (prior?.status === "pending") {
      return {
        ...scriptedObligationPlan({ town, resident, now }),
        modelTelemetry: {
          attempted: false,
          fallback: true,
          skipped: true,
          errorCode: "interrupted-request-guard",
          policyReason: "prior-request-outcome-unknown",
          model: this.env?.DEEPSEEK_MODEL ?? null,
        },
      };
    }

    let requestStarted = false;
    const providerFetch = this.env?.DEEPSEEK_FETCH ?? globalThis.fetch;
    const guardedFetch = async (...args) => {
      requestStarted = true;
      if (typeof storage.put === "function") {
        await storage.put(decisionKey, {
          status: "pending",
          residentId: resident.id,
          simulatedAt: new Date(now).toISOString(),
          requestedAt: new Date(wallClock).toISOString(),
        });
      }
      return providerFetch(...args);
    };
    const plan = await planResidentDecision({ town, resident, now }, {
      env: this.env,
      fetchImpl: guardedFetch,
      wallClock,
      bypassPeakPricing,
    });
    if (requestStarted && typeof storage.put === "function") {
      await storage.put(decisionKey, {
        status: "complete",
        residentId: resident.id,
        simulatedAt: new Date(now).toISOString(),
        completedAt: new Date(wallClock).toISOString(),
        plan: clone(plan),
      });
    }
    return plan;
  }

  async runAlarm(options = {}) {
    const wallClock = options.wallClock ?? new Date();
    const retryCount = Number.isSafeInteger(options.retryCount) ? options.retryCount : 0;
    const isRetry = options.isRetry === true || retryCount > 0;
    const state = await this.load({ scheduleAlarm: false });
    const previousAttempt = typeof this.ctx.storage.get === "function"
      ? await this.ctx.storage.get(ALARM_ATTEMPT_KEY)
      : null;

    if (isRetry && previousAttempt?.fromSimulatedAt && state.now !== previousAttempt.fromSimulatedAt) {
      if (typeof this.ctx.storage.put === "function") {
        await this.ctx.storage.put(ALARM_ATTEMPT_KEY, {
          ...previousAttempt,
          status: "complete",
          recoveredOnRetry: true,
        });
      }
      await this.ctx.storage.setAlarm(new Date(wallClock).getTime() + HEARTBEAT_INTERVAL_MS);
      return { status: "already-advanced", from: previousAttempt.fromSimulatedAt, to: state.now };
    }

    if (typeof this.ctx.storage.put === "function") {
      await this.ctx.storage.put(ALARM_ATTEMPT_KEY, {
        status: "pending",
        fromSimulatedAt: state.now,
        startedAt: new Date(wallClock).toISOString(),
        retryCount,
      });
    }
    const next = await advanceTown(state, {
      minutes: SIMULATION_STEP_MINUTES,
      decisionAdapter: (input) => this.decisionPlanFor(input, { wallClock }),
    });
    next.environment = this.environment;
    next.mode = modeFor(this.environment);
    next.persistence = "durable-object";
    next.operations = {
      ...(next.operations ?? {}),
      catchUpPolicy: "pause-on-downtime",
      lastHeartbeatAt: new Date(wallClock).toISOString(),
      lastHeartbeatRetryCount: retryCount,
      lastHeartbeatAdvancedFrom: state.now,
      lastHeartbeatAdvancedTo: next.now,
    };
    this.persist(next);
    if (typeof this.ctx.storage.put === "function") {
      await this.ctx.storage.put(ALARM_ATTEMPT_KEY, {
        status: "complete",
        fromSimulatedAt: state.now,
        toSimulatedAt: next.now,
        completedAt: new Date(wallClock).toISOString(),
        retryCount,
      });
    }
    await this.ctx.storage.setAlarm(new Date(wallClock).getTime() + HEARTBEAT_INTERVAL_MS);
    return { status: "advanced", from: state.now, to: next.now };
  }

  async alarm(options = {}) {
    const wallClock = options.wallClock ?? new Date();
    try {
      const result = await this.runAlarm({ ...options, wallClock });
      if (typeof this.ctx.storage.put === "function") {
        await this.ctx.storage.put(ALARM_FAILURE_KEY, {
          status: "healthy",
          recoveredAt: new Date(wallClock).toISOString(),
        });
      }
      return result;
    } catch (error) {
      const failure = {
        status: "failed",
        failedAt: new Date(wallClock).toISOString(),
        error: error?.name ?? "AlarmError",
        retryCount: Number.isSafeInteger(options.retryCount) ? options.retryCount : 0,
      };
      if (typeof this.ctx.storage.put === "function") {
        await this.ctx.storage.put(ALARM_FAILURE_KEY, failure);
      }
      await this.ctx.storage.setAlarm(new Date(wallClock).getTime() + HEARTBEAT_INTERVAL_MS);
      return { ...failure, nextAttemptAt: new Date(new Date(wallClock).getTime() + HEARTBEAT_INTERVAL_MS).toISOString() };
    }
  }
}
