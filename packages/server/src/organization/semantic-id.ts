/**
 * A semantic id derived from a display name without a model (pure, unit tested): the ASCII
 * fallback of `POST /organizations/suggest-id`, and the sanitizer every model answer passes
 * through before it is offered. Diacritics are folded (`Café` → `cafe`), every run of anything
 * but a letter or digit becomes one underscore, the result is lowercased, and a name that
 * starts with a digit gets the kind's prefix so the id starts with a letter as the rule
 * demands. A name with no ASCII letters or digits at all (a Chinese name) yields null: nothing
 * mechanical can name it, and that is exactly the case the model exists for.
 */
import { SEMANTIC_ID_PATTERN } from "../services/ids.js";

export type SemanticIdKind = "org" | "channel";

const KIND_PREFIX: Record<SemanticIdKind, string> = { org: "org", channel: "channel" };

const MAX_LENGTH = 64;

/** The ASCII core of a name: folded, lowercased, `_`-joined; "" when nothing survives. */
function asciiCore(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `base`, or the first `base_2`, `base_3`, … that `taken` does not hold; the suffix never pushes the id past the length cap. */
export function uniqueSemanticId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A valid semantic id for a name, or null when the name carries nothing an ASCII id can be
 * built from. Never returns an id in `taken`.
 */
export function fallbackSemanticId(
  name: string,
  kind: SemanticIdKind,
  taken: Iterable<string> = [],
): string | null {
  let core = asciiCore(name);
  if (core === "") return null;
  if (!/^[a-z]/.test(core)) core = `${KIND_PREFIX[kind]}_${core}`;
  if (core.length < 2) core = `${KIND_PREFIX[kind]}_${core}`;
  core = core.slice(0, MAX_LENGTH).replace(/_+$/, "");
  if (!SEMANTIC_ID_PATTERN.test(core)) return null;
  return uniqueSemanticId(core, taken);
}

/**
 * What a model's answer becomes: its first line, stripped of quotes and code marks, run
 * through the same folding as a name — so a model that answers `research_lab` keeps it, one
 * that answers `` `Research Lab` `` still yields `research_lab`, and one that answers in
 * Chinese yields null and the caller falls back.
 */
export function sanitizeSuggestedId(
  answer: string,
  kind: SemanticIdKind,
  taken: Iterable<string> = [],
): string | null {
  const line = answer
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (line === undefined) return null;
  return fallbackSemanticId(line.replace(/^[`"'“”‘’]+|[`"'“”‘’.]+$/g, ""), kind, taken);
}
