import { runScenario } from "../src/scenario-runner.js";

function usage() {
  return [
    "Usage: npm run scenario -- [--days 1,7,30,90] [--seed NAME] [--json]",
    "",
    "Runs a clean in-memory staging town through the same deterministic engine",
    "used by the Worker and prints checkpoint diagnostics without changing the",
    "public preview tick limit or any Durable Object state.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { days: [1, 7, 30, 90], seed: "calder-station-long-horizon", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--days" || argument === "--seed") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--seed") {
        options.seed = value;
      } else {
        const days = value.split(",").map((part) => Number(part));
        if (days.some((day) => !Number.isInteger(day) || day < 1)) {
          throw new Error("--days must be a comma-separated list of positive whole days");
        }
        options.days = [...new Set(days)].sort((left, right) => left - right);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = runScenario({
    days: Math.max(...options.days),
    checkpoints: options.days,
    seed: options.seed,
  });
  const output = {
    kind: result.kind,
    seed: result.seed,
    seedRevision: result.seedRevision,
    startTime: result.startTime,
    days: result.days,
    tickMinutes: result.tickMinutes,
    checkpoints: result.checkpoints,
    final: result.final,
  };
  console.log(options.json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
}
