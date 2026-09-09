/**
 * A semantic id derived from a display name without a model (pure, unit tested): the ASCII
 * fallback of `POST /organizations/suggest-id`, and the sanitizer every model answer passes
 * through before it is offered. Diacritics are folded (`Café` → `cafe`), every run of
 * anything but a letter or digit becomes one underscore, and the result is lowercased. The
 * kind's prefix is then put in front — `co_` for an organization, `ch_` for a channel — so a
 * suggested id says what it names and starts with a letter as the rule demands; a core that
 * already carries the prefix is not prefixed twice. A name with no ASCII letters or digits
 * at all (a Chinese name) yields null: nothing mechanical can name it, and that is exactly
 * the case the model exists for.
 */
import { SEMANTIC_ID_PATTERN } from "../services/ids.js";

export type SemanticIdKind = "org" | "channel";

/**
 * The prefix every generated id carries, by kind. A convention, not a rule the server
 * enforces: an id typed by hand is accepted as written, and ids that predate the convention
 * keep working.
 */
export const KIND_PREFIX: Record<SemanticIdKind, string> = { org: "co_", channel: "ch_" };

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

/** The core with its kind's prefix in front, or unchanged when it already starts with it. */
export function prefixSemanticId(core: string, kind: SemanticIdKind): string {
  const prefix = KIND_PREFIX[kind];
  return core.startsWith(prefix) ? core : `${prefix}${core}`;
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
  const core = asciiCore(name);
  if (core === "") return null;
  // Prefix first, then cap: the prefix is the part that must survive a long name.
  const id = prefixSemanticId(core, kind).slice(0, MAX_LENGTH).replace(/_+$/, "");
  if (!SEMANTIC_ID_PATTERN.test(id)) return null;
  return uniqueSemanticId(id, taken);
}

/**
 * What a model's answer becomes: its first line, stripped of quotes and code marks, run
 * through the same folding and prefixing as a name — so a model that answers `research_lab`
 * yields `co_research_lab`, one that answers `` `Research Lab` `` yields the same, one that
 * answers `co_research_lab` is not prefixed twice, and one that answers in Chinese yields
 * null and the caller falls back.
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
