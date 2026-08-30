import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { townSeed } from "../src/demo-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the Folio shell is the only active frontend generation", () => {
  const index = read("public/index.html");
  const app = read("public/folio-app.js");

  assert.match(index, /folio-app\.js/);
  assert.match(index, /folio-base\.css/);
  assert.doesNotMatch(index, /styles\.css|town-brand\.js/);
  assert.doesNotMatch(app, /Rookwood|ROOKWOOD|Sal Orin|Vey Arlen|replaceLegacy/);
  for (const oldFile of ["public/app.js", "public/map.css", "public/rookwood-map.svg", "public/styles.css", "public/town-brand.js"]) {
    assert.equal(fs.existsSync(path.join(root, oldFile)), false, `${oldFile} should be removed`);
  }
});

test("every authored resident has a portrait URL in the Folio renderer", () => {
  const app = read("public/folio-app.js");
  assert.match(app, /resident-icons/);
  for (const resident of townSeed.residents) {
    assert.match(app, new RegExp(`resident-icons/\\$\\{encodeURIComponent\\(resident\\.portraitKey\\)\\}`));
    assert.equal(typeof resident.portraitKey, "string");
    assert.ok(resident.portraitKey.length > 0, `${resident.id} needs a portrait key`);
  }
});

test("the Folio distinguishes causal history from routine telemetry", () => {
  const app = read("public/folio-app.js");

  assert.match(app, /CONSEQUENTIAL_EVENT_TYPES/);
  assert.match(app, /What may endure/);
  assert.match(app, /What is owed/);
  assert.match(app, /status === "open" && obligation\.ownerId === residentId/);
  assert.match(app, /baselineStrength/);
  assert.match(app, /api\/events\?limit=200/);
  assert.match(app, /Follows \$\{parent\.title\}/);
  assert.match(app, /DeepSeek prioritized/);
  assert.match(app, /plan-itinerary/);
  assert.doesNotMatch(app, /DeepSeek shaped this decision/);
  assert.doesNotMatch(app, /Obligation:.*obligation\.status/);
});
