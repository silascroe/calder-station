import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateDeployConfig(config) {
  const errors = [];
  const productionBinding = config?.durable_objects?.bindings?.find(({ name }) => name === "TOWN");
  const staging = config?.env?.staging;
  const stagingBinding = staging?.durable_objects?.bindings?.find(({ name }) => name === "TOWN");

  if (config?.vars?.TOWN_ENV !== "production") {
    errors.push("top-level vars.TOWN_ENV must be production");
  }
  if (!productionBinding || productionBinding.class_name !== "RookwoodTown") {
    errors.push("production must bind TOWN to RookwoodTown");
  }
  if (!staging || staging.vars?.TOWN_ENV !== "staging") {
    errors.push("env.staging.vars.TOWN_ENV must be staging");
  }
  if (!stagingBinding || stagingBinding.class_name !== "RookwoodTown") {
    errors.push("staging must explicitly bind TOWN to RookwoodTown; bindings are not inherited");
  }
  if (stagingBinding?.script_name) {
    errors.push("staging TOWN must not point at another Worker through script_name");
  }
  if (!staging?.name || staging.name === config?.name) {
    errors.push("staging must deploy under a Worker name distinct from production");
  }
  if (config?.exports?.RookwoodTown?.storage !== "sqlite") {
    errors.push("RookwoodTown must remain declared as SQLite-backed storage");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid deployment configuration:\n- ${errors.join("\n- ")}`);
  }
  return {
    productionWorker: config.name,
    stagingWorker: staging.name,
    durableObjectClass: stagingBinding.class_name,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
  const result = validateDeployConfig(config);
  console.log(`Deployment config valid: ${result.productionWorker} / ${result.stagingWorker} / ${result.durableObjectClass}`);
}
