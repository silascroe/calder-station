const RETRIES = 8;
const RETRY_DELAY_MS = 2_500;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
  }
}

async function readJson(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, {
    headers: { "cache-control": "no-cache" },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}: ${body.error ?? "unknown error"}`);
  }
  return body;
}

export async function smokeDeployment({ url, environment, object }) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const [health, town] = await Promise.all([
        readJson(url, "/api/health"),
        readJson(url, "/api/town"),
      ]);
      assertEqual(health.ok, true, "health.ok");
      assertEqual(health.environment, environment, "health.environment");
      assertEqual(health.persistence, "durable-object", "health.persistence");
      assertEqual(health.object, object, "health.object");
      assertEqual(town.environment, environment, "town.environment");
      assertEqual(town.persistence, "durable-object", "town.persistence");
      if (!health.alarmAt) throw new Error("health.alarmAt was not scheduled");
      return { health, town };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const url = argument("url");
  const environment = argument("environment");
  const object = argument("object");
  if (!url || !environment || !object) {
    throw new Error("Usage: smoke-deployment.mjs --url URL --environment NAME --object KEY");
  }
  const result = await smokeDeployment({ url, environment, object });
  console.log(`Deployment healthy: ${result.health.environment} / ${result.health.persistence} / ${result.health.object}`);
}
