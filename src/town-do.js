import {
  advanceTown,
  createInitialTown,
  reconcileTownWithSeed,
  townView,
} from "./simulation.js";
import {
  openObligationFor,
  scriptedObligationPlan,
} from "./obligations.js";
import {
  createDeepSeekPlan,
  DEFAULT_DEEPSEEK_MODEL,
  MODEL_RESIDENT_ID,
} from "./deepseek-planner.js";

export const TOWN_NAME = "rookwood";
export const SIMULATION_STEP_MINUTES = 60;
export const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_EVENT_LIMIT = 80;
export const MAX_EVENT_LIMIT = 200;

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

function dueWithin(state, residentId, minutes) {
  const resident = state.residents.find(({ id }) => id === residentId);
  if (!resident?.nextDecisionAt) return null;
  const decisionAt = new Date(resident.nextDecisionAt);
  const horizon = new Date(new Date(state.now).getTime() + minutes * 60 * 1000);
  if (Number.isNaN(decisionAt.getTime()) || decisionAt > horizon) return null;
  return { resident, decisionAt };
}

/** One serialized owner for Rookwood's projection, event log, and heartbeat. */
export class RookwoodTown {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
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
        TOWN_NAME,
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

  readEvents(limit = DEFAULT_EVENT_LIMIT) {
    return this.sql
      .exec(
        `SELECT event_json FROM town_events
         ORDER BY at DESC, id DESC
         LIMIT ?`,
        limit,
      )
      .toArray()
      .map(({ event_json }) => JSON.parse(event_json));
  }

  async load() {
    const rows = this.sql
      .exec("SELECT state_json FROM town_state WHERE id = ?", TOWN_NAME)
      .toArray();

    if (rows.length === 0) {
      const state = createInitialTown();
      state.mode = "persistent-scripted-simulation";
      state.persistence = "durable-object";
      state.summary = "A small town continuing under deterministic game rules.";
      this.persist(state);
      await this.ensureAlarm();
      return state;
    }

    const stored = JSON.parse(rows[0].state_json);
    // Keep only a small recent window in memory for the next decision. The
    // full history remains in SQLite and is never sent to the model.
    stored.events = this.readEvents(8).reverse();
    const reconciled = reconcileTownWithSeed(stored);
    if (reconciled.needsPersist) this.persist(reconciled.state);
    await this.ensureAlarm();
    return reconciled.state;
  }

  async fetch(request) {
    if (request.method !== "GET") {
      return json({ error: "Only GET is supported by the town object." }, 405);
    }

    const url = new URL(request.url);
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
        });
      }

      if (url.pathname === "/health") {
        const state = await this.load();
        const alarmAt = await this.ensureAlarm();
        return json({
          ok: true,
          service: "town-dashboard",
          mode: state.mode,
          engine: this.env?.DEEPSEEK_API_KEY ? "hybrid-scripted-deepseek" : "deterministic-scripted",
          modelReady: Boolean(this.env?.DEEPSEEK_API_KEY),
          persistence: state.persistence,
          object: TOWN_NAME,
          seedRevision: state.seedRevision,
          tickCount: state.stats.tickCount,
          eventCount: state.stats.eventCount,
          modelCalls: state.stats.modelCalls,
          modelAttempts: state.stats.modelAttempts,
          modelFallbacks: state.stats.modelFallbacks,
          modelPromptTokens: state.stats.modelPromptTokens,
          modelCompletionTokens: state.stats.modelCompletionTokens,
          alarmAt: alarmAt === null ? null : new Date(alarmAt).toISOString(),
          serverTime: new Date().toISOString(),
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

  async modelPlanFor(state) {
    if (!this.env?.DEEPSEEK_API_KEY) return null;

    const due = dueWithin(state, MODEL_RESIDENT_ID, SIMULATION_STEP_MINUTES);
    if (!due || !openObligationFor(state, due.resident.id)) return null;

    try {
      const plan = await createDeepSeekPlan({
        state,
        resident: due.resident,
        now: due.decisionAt,
        obligation: openObligationFor(state, due.resident.id),
        env: this.env,
        fetchImpl: this.env.DEEPSEEK_FETCH ?? globalThis.fetch,
      });
      return { decisionAt: due.decisionAt.toISOString(), plan };
    } catch (error) {
      return {
        decisionAt: due.decisionAt.toISOString(),
        plan: {
          ...scriptedObligationPlan({
            town: state,
            resident: due.resident,
            now: due.decisionAt,
          }),
          modelTelemetry: {
            attempted: true,
            fallback: true,
            model: this.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
            ...(error.telemetry ?? {}),
            errorCode: error.code ?? "request_failed",
          },
        },
      };
    }
  }

  async alarm() {
    const state = await this.load();
    const modelRun = await this.modelPlanFor(state);
    const next = advanceTown(state, {
      minutes: SIMULATION_STEP_MINUTES,
      decisionAdapter: ({ town, resident, now }) => {
        if (modelRun
          && resident.id === MODEL_RESIDENT_ID
          && now.toISOString() === modelRun.decisionAt) {
          return modelRun.plan;
        }
        return scriptedObligationPlan({ town, resident, now });
      },
    });
    this.persist(next);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
  }
}
