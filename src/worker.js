import { demoEvents, demoTown } from "./demo-data.js";

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
  return json({ error: "Only GET is supported by the demo API." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return methodNotAllowed();

      if (url.pathname === "/api/health") {
        return json({
          ok: true,
          service: "town-dashboard",
          mode: "demo",
          serverTime: new Date().toISOString(),
        });
      }

      if (url.pathname === "/api/town") {
        return json({ ...demoTown, serverTime: new Date().toISOString() });
      }

      if (url.pathname === "/api/events") {
        return json({ events: demoEvents });
      }

      return json({ error: "API route not found." }, 404);
    }

    if (!env.ASSETS) {
      return new Response("Static asset binding is not configured.", { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
