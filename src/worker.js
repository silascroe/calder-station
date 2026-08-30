import {
  eventView,
  previewOptions,
  runPreview,
  townView,
} from "./simulation.js";
import { RookwoodTown, TOWN_NAME } from "./town-do.js";

export { RookwoodTown };

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

function methodNotAllowed() {
  return json({ error: "Only GET is supported by the read-only API." }, 405);
}

function previewFromUrl(url) {
  return runPreview(previewOptions(url));
}

function shouldUsePersistentTown(url, env) {
  return typeof env?.TOWN?.getByName === "function"
    && !url.searchParams.has("ticks")
    && url.searchParams.get("preview") !== "1";
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
  const stub = env.TOWN.getByName(TOWN_NAME);
  return stub.fetch(persistentRequest(url, path));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return methodNotAllowed();

      try {
        if (url.pathname === "/api/health") {
          if (shouldUsePersistentTown(url, env)) {
            return await persistentApi(env, url, "/health");
          }

          const state = previewFromUrl(url);
          return json({
            ok: true,
            service: "town-dashboard",
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

          return json(townView(previewFromUrl(url)));
        }

        if (url.pathname === "/api/events") {
          if (shouldUsePersistentTown(url, env)) {
            return await persistentApi(env, url, "/events");
          }

          const state = previewFromUrl(url);
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
};
