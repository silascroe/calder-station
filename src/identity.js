/**
 * Public identity is separate from the stable storage identity. The latter is
 * deliberately retained so a rename cannot strand the production Durable
 * Object behind a new name.
 */
export const TOWN_WORLD_ID = "rookwood";
export const TOWN_DISPLAY_NAME = "Calder Station";
export const TOWN_STORAGE_KEY = "rookwood";

// These are migration-only translations for event records written before the
// town's editorial identity was finalized. They must never be used as a live
// presentation layer.
export const LEGACY_TEXT_REPLACEMENTS = Object.freeze([
  ["Rookwood Hall", "Calder Hall"],
  ["Mara Venn", "Mara Konstantinidis"],
  ["Sal Orin", "Sal D’Amico"],
  ["Irena Vale", "Irena Kaczmarek"],
  ["Thom Reed", "Tom Reed"],
  ["June Lark", "June Collins"],
  ["Bram Ash", "Ben Carter"],
  ["Corin Pike", "Corin Price"],
  ["Pella Moss", "Paula Morris"],
  ["Edda Rusk", "Erin Russell"],
  ["Vey Arlen", "Jamie Allen"],
  ["Tamsin Fenn", "Tamsin Moore"],
  ["Amos Grey", "Amos Foster"],
  ["Lio Pike", "Leo Price"],
  ["ROOKWOOD", "CALDER STATION"],
  ["Rookwood", "Calder Station"],
  ["Thom", "Tom"],
  ["Bram", "Ben"],
  ["Pella", "Paula"],
  ["Edda", "Erin"],
  ["Vey", "Jamie"],
  ["Lio", "Leo"],
]);

export function migrateLegacyText(value) {
  let result = String(value ?? "");
  for (const [legacy, current] of LEGACY_TEXT_REPLACEMENTS) {
    if (legacy !== current) result = result.replaceAll(legacy, current);
  }
  return result;
}

export function migrateLegacyEvent(event) {
  const next = { ...event };
  for (const field of ["actor", "text", "reason"]) {
    if (typeof next[field] === "string") next[field] = migrateLegacyText(next[field]);
  }
  return next;
}
