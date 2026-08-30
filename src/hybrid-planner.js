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

const MODEL_CONFLICT_HORIZON_MS = 24 * 60 * 60 * 1000;

export function modelConflictCandidates(town, resident, now) {
  const planningAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(planningAt.getTime())) return [];
  const beforeNextTurn = planningAt.getTime() + MODEL_CONFLICT_HORIZON_MS;
  return (town?.obligations ?? [])
    .filter((obligation) => (
      obligation.ownerId === resident?.id
      && obligation.status === "open"
      && Number.isFinite(new Date(obligation.dueAt).getTime())
      && new Date(obligation.dueAt).getTime() <= beforeNextTurn
    ))
    .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)) || left.id.localeCompare(right.id));
}

export function modelConflictEligible(town, resident, now) {
  if (resident?.id !== MODEL_RESIDENT_ID) return false;
  if (resident.hunger >= 94 || resident.energy <= 12) return false;
  return modelConflictCandidates(town, resident, now).length >= 2;
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

  const obligation = openObligationFor(town, resident.id);
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
