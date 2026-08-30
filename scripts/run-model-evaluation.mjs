import { runModelEvaluation } from "../src/model-evaluation.js";

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("DEEPSEEK_API_KEY is required; the key is read from the process environment and is never printed");
}

const report = await runModelEvaluation({
  env: {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ...(process.env.DEEPSEEK_MODEL ? { DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL } : {}),
  },
});

console.log(JSON.stringify(report, null, 2));
