import { deepSeekReflectionAdapter } from "../src/deepseek-reflection.js";
import {
  REFLECTION_EVALUATION_DEFAULT_DAYS,
  runReflectionComparison,
} from "../src/reflection-evaluation.js";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const days = Number(valueAfter("--days") ?? process.env.REFLECTION_DAYS ?? REFLECTION_EVALUATION_DEFAULT_DAYS);
const intervalDays = Number(valueAfter("--interval") ?? process.env.REFLECTION_INTERVAL_DAYS ?? 24);
const live = args.includes("--live") || process.env.REFLECTION_LIVE === "true";
if (live && !process.env.DEEPSEEK_API_KEY) throw new Error("--live requires DEEPSEEK_API_KEY");

const wallClock = live ? new Date() : new Date("2026-09-01T00:30:00.000Z");
const reflectionAdapter = live
  ? deepSeekReflectionAdapter({
    env: {
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    },
    bypassPeakPricing: true,
  })
  : undefined;

const report = await runReflectionComparison({
  days,
  intervalDays,
  wallClock,
  ...(reflectionAdapter ? { reflectionAdapter } : {}),
});
console.log(JSON.stringify({ ...report, execution: { live, wallClock: wallClock.toISOString() } }, null, 2));
