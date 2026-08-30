import {
  openObligationFor,
  scriptedObligationPlan,
} from "./obligations.js";
import { modelCallPolicy } from "./scheduler.js";
import {
  createDeepSeekPlan,
  DEFAULT_DEEPSEEK_MODEL,
  MODEL_RESIDENT_ID,
} from "./deepseek-planner.js";
import {
  bestObligationOrder,
  obligationsBeforeNextTurn,
  projectObligationOrder,
} from "./travel.js";

export function modelConflictCandidates(town, resident, now) {
  return obligationsBeforeNextTurn(town, resident, now);
}

export function modelConflictEligible(town, resident, now) {
  if (resident?.id !== MODEL_RESIDENT_ID) return false;
  if (resident.hunger >= 94 || resident.energy <= 12) return false;
  const candidates = modelConflictCandidates(town, resident, now)
    .filter((obligation) => projectObligationOrder(town, resident, [obligation], now).allMeet);
  if (candidates.length < 2) return false;
  return !bestObligationOrder(town, resident, candidates, now).projection.allMeet;
}

/**
 * Shared scripted/model boundary for the persistent town and deliberate
 * evaluation. It receives an authoritative simulation snapshot and returns
 * intent only; validation and consequences remain in the engine.
 */
export async function planResidentDecision({ town, resident, now }, {
  env = {},
  fetchImpl = env.DEEPSEEK_FETCH ?? globalThis.fetch,
  wallClock = new Date(),
  bypassPeakPricing = false,
} = {}) {
  const scripted = () => scriptedObligationPlan({ town, resident, now });
  if (!env.DEEPSEEK_API_KEY || !modelConflictEligible(town, resident, now)) return scripted();

  const obligation = modelConflictCandidates(town, resident, now)
    .find((candidate) => projectObligationOrder(town, resident, [candidate], now).allMeet)
    ?? openObligationFor(town, resident.id);
  if (!obligation) return scripted();

  const policy = modelCallPolicy({ wallClock, bypassPeakPricing });
  if (!policy.allowed) {
    return {
      ...scripted(),
      modelTelemetry: {
        attempted: false,
        fallback: false,
        skipped: true,
        policyReason: policy.reason,
        model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
      },
    };
  }

  try {
    return await createDeepSeekPlan({
      state: town,
      resident,
      now,
      obligation,
      env,
      fetchImpl,
    });
  } catch (error) {
    return {
      ...scripted(),
      modelTelemetry: {
        attempted: true,
        fallback: true,
        model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
        ...(error.telemetry ?? {}),
        errorCode: error.code ?? "request_failed",
      },
    };
  }
}
