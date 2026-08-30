import {
  advanceTown,
  createInitialTown,
  eventView,
  townView,
} from "./simulation.js";

export const TOWN_NAME = "rookwood";
export const SIMULATION_STEP_MINUTES = 60;
export const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

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
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureSchema(sql) {
  sql.exec(SCHEMA);
}

function projectionFor(state) {
  const projection = clone(state);
  projection.events = [];
  return projection;
}

/**
 * One object owns the first persistent town. Residents remain ordinary data;
 * the object serializes access to the world projection and its event log.
 *
 * This class deliberately uses the standard (ctx, env) Durable Object
 * constructor shape without importing a platform-only module. That keeps the
 * dependency-free Node test suite useful while Wrangler registers the export
 * as the SQLite-backed Durable Object class.
 */
export class RookwoodTown {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;

    const initialize = async () => {
      ensureSchema(this.sql);
    };

    if (typeof ctx.blockConcurrencyWhile === "function") {
      ctx.blockConcurrencyWhile(initialize);
    } else {
      ensureSchema(this.sql);
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

      for (const event of state.events) {
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

  async load() {
    const rows = this.sql
      .exec("SELECT state_json FROM town_state WHERE id = ?", TOWN_NAME)
      .toArray();

    if (rows.length === 0) {
      const state = createInitialTown();
      state.mode = "persistent-scripted-simulation";
      state.persistence = "durable-object";
      state.summary = "A persistent Rookwood simulation driven by ordinary game-AI rules.";
      this.persist(state);
      await this.ensureAlarm();
      return state;
    }

    const state = JSON.parse(rows[0].state_json);
    state.events = this.sql
      .exec("SELECT event_json FROM town_events ORDER BY at ASC, id ASC")
      .toArray()
      .map(({ event_json }) => JSON.parse(event_json));
    state.stats.eventCount = state.events.length;
    await this.ensureAlarm();
    return state;
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
          events: eventView(state),
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
          engine: "deterministic-scripted",
          persistence: state.persistence,
          object: TOWN_NAME,
          tickCount: state.stats.tickCount,
          modelCalls: state.stats.modelCalls,
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

  async alarm() {
    const state = await this.load();
    const next = advanceTown(state, { minutes: SIMULATION_STEP_MINUTES });
    this.persist(next);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
  }
}
