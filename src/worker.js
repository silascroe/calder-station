import {
  eventView,
  previewOptions,
  runPreview,
  townView,
} from "./simulation.js";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return methodNotAllowed();

      try {
        if (url.pathname === "/api/health") {
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
          return json(townView(previewFromUrl(url)));
        }

        if (url.pathname === "/api/events") {
          const state = previewFromUrl(url);
          return json({
            events: eventView(state),
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
