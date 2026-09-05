const DAY_MS = 24 * 60 * 60 * 1000;

export const REFLECTION_VERSION = 1;
export const REFLECTION_MODES = Object.freeze(["disabled", "accelerated", "fast_test"]);
export const DEFAULT_REFLECTION_INTERVAL_DAYS = 24;
export const MAX_REFLECTION_NOTE_LENGTH = 160;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return date;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeReflectionPolicy(policy = {}) {
  if (policy === null || policy === undefined) {
    return { mode: "disabled", intervalDays: DEFAULT_REFLECTION_INTERVAL_DAYS, residentIds: null };
  }
  if (typeof policy !== "object") throw new TypeError("reflectionPolicy must be an object");
  const mode = policy.mode ?? "disabled";
  if (!REFLECTION_MODES.includes(mode)) throw new RangeError(`Unsupported reflection mode: ${mode}`);
  const intervalDays = policy.intervalDays ?? DEFAULT_REFLECTION_INTERVAL_DAYS;
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    throw new RangeError("reflection intervalDays must be a whole number between 1 and 365");
  }
  if (policy.residentIds !== undefined && policy.residentIds !== null) {
    if (!Array.isArray(policy.residentIds)
      || policy.residentIds.some((id) => typeof id !== "string" || id.length === 0)
      || new Set(policy.residentIds).size !== policy.residentIds.length) {
      throw new TypeError("reflection residentIds must be unique non-empty strings");
    }
  }
  return {
    mode,
    intervalDays,
    residentIds: policy.residentIds ? [...policy.residentIds] : null,
  };
}

export function reflectionTargetOptions(town, resident) {
  if (!town || !resident) return [];
  return (town.relationships ?? [])
    .filter((relationship) => relationship.fromId === resident.id || relationship.toId === resident.id)
    .map((relationship) => {
      const targetId = relationship.fromId === resident.id ? relationship.toId : relationship.fromId;
      const target = (town.residents ?? []).find(({ id }) => id === targetId);
      if (!target) return null;
      return {
        targetId,
        name: target.name,
        role: target.role,
        relationship: relationship.kind,
        strength: relationship.strength,
        tension: relationship.tension ?? 0,
        interactions: relationship.interactionCount ?? 0,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.interactions - right.interactions
      || right.tension - left.tension
      || left.targetId.localeCompare(right.targetId)
    ));
}

export function validateReflection(value, { town, resident } = {}) {
  if (!value || typeof value !== "object") throw new TypeError("Reflection must be an object");
  const keys = Object.keys(value).filter((key) => !["source", "modelTelemetry"].includes(key)).sort();
  if (keys.join(",") !== "focusTargetId,note") {
    throw new RangeError("Reflection returned fields outside the bounded focus contract");
  }
  if (value.focusTargetId !== null && typeof value.focusTargetId !== "string") {
    throw new TypeError("Reflection focusTargetId must be a related resident ID or null");
  }
  if (value.focusTargetId !== null) {
    if (value.focusTargetId === resident?.id) {
      throw new RangeError("Reflection focusTargetId must name another resident");
    }
    if (!reflectionTargetOptions(town, resident).some(({ targetId }) => targetId === value.focusTargetId)) {
      throw new RangeError("Reflection focusTargetId must name a recorded relationship");
    }
  }
  if (typeof value.note !== "string"
    || value.note.trim().length === 0
    || value.note.length > MAX_REFLECTION_NOTE_LENGTH) {
    throw new TypeError(`Reflection note must be a non-empty string under ${MAX_REFLECTION_NOTE_LENGTH} characters`);
  }
  return { focusTargetId: value.focusTargetId, note: value.note.trim() };
}

export function ensureReflectionSchedule(resident, startedAt, policy) {
  const normalized = normalizeReflectionPolicy(policy);
  const current = resident.reflection && typeof resident.reflection === "object" ? resident.reflection : {};
  if (normalized.mode === "disabled") {
    resident.reflection = {
      version: REFLECTION_VERSION,
      lastReflectedAt: current.lastReflectedAt ?? null,
      nextReflectionAt: current.nextReflectionAt ?? null,
      staggerDays: current.staggerDays ?? 0,
      focusTargetId: current.focusTargetId ?? null,
      note: current.note ?? null,
      source: current.source ?? null,
      model: current.model ?? null,
    };
    return resident.reflection;
  }
  if (current.nextReflectionAt && !Number.isNaN(new Date(current.nextReflectionAt).getTime())) {
    resident.reflection = {
      version: REFLECTION_VERSION,
      lastReflectedAt: current.lastReflectedAt ?? null,
      nextReflectionAt: current.nextReflectionAt,
      staggerDays: current.staggerDays ?? 0,
      focusTargetId: current.focusTargetId ?? null,
      note: current.note ?? null,
      source: current.source ?? null,
      model: current.model ?? null,
    };
    return resident.reflection;
  }
  const started = asDate(startedAt);
  const staggerDays = stableHash(`reflection:${resident.id}`) % normalized.intervalDays;
  resident.reflection = {
    version: REFLECTION_VERSION,
    lastReflectedAt: null,
    nextReflectionAt: new Date(started.getTime() + (normalized.intervalDays + staggerDays) * DAY_MS).toISOString(),
    staggerDays,
    focusTargetId: null,
    note: null,
    source: null,
    model: null,
  };
  return resident.reflection;
}

export function reflectionIsDue(resident, at, policy) {
  const normalized = normalizeReflectionPolicy(policy);
  if (normalized.mode === "disabled") return false;
  if (normalized.residentIds && !normalized.residentIds.includes(resident?.id)) return false;
  if (!resident?.reflection?.nextReflectionAt) return false;
  return asDate(at).getTime() >= asDate(resident.reflection.nextReflectionAt).getTime();
}

export function activeReflectionFocus(resident) {
  const reflection = resident?.reflection;
  if (!reflection?.focusTargetId || !reflection.lastReflectedAt) return null;
  if (resident.lastDecisionAt
    && asDate(resident.lastDecisionAt).getTime() >= asDate(reflection.lastReflectedAt).getTime()) return null;
  return reflection.focusTargetId;
}

export function applyReflection(resident, value, at, policy, { town, source = "scripted", model = null } = {}) {
  const normalized = normalizeReflectionPolicy(policy);
  const reflectedAt = asDate(at);
  const reflection = validateReflection(value, { town, resident });
  const previous = resident.reflection ?? {};
  resident.reflection = {
    version: REFLECTION_VERSION,
    lastReflectedAt: reflectedAt.toISOString(),
    nextReflectionAt: new Date(reflectedAt.getTime() + normalized.intervalDays * DAY_MS).toISOString(),
    staggerDays: previous.staggerDays ?? 0,
    focusTargetId: reflection.focusTargetId,
    note: reflection.note,
    source,
    model,
  };
  return clone(resident.reflection);
}
