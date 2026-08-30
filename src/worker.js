import {
  eventView,
  previewOptions,
  runPreview,
  townView,
} from "./simulation.js";
import { RookwoodTown, townStorageKey } from "./town-do.js";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return methodNotAllowed();

      if (["/api/health", "/api/town", "/api/events"].includes(url.pathname)) {
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
