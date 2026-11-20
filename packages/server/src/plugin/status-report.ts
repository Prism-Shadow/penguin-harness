/**
 * A settings group's status report (`PluginStatusReport`), made safe to send: a plugin's
 * `report()` is its own code, built against whatever version of the contract it was written for,
 * so what it returns is checked here rather than trusted.
 *
 * Version skew is the normal case, not an error: a plugin newer than this build may name a state
 * this build has never heard of, and an older one may leave out what a newer page would show. So
 * a state outside the known set reads as `unknown` (the page draws that, never a crash); a field
 * of the wrong type is dropped; a version without a name, a summary without text and a check
 * without an id or a label are dropped whole; a progress outside 0–1 is clamped. Nothing a
 * plugin sends is passed on unchecked, and nothing here throws.
 */
import type {
  PluginStatusCheck,
  PluginStatusReport,
  PluginStatusSummary,
  PluginStatusVersion,
} from "../api/types.js";

const SUMMARY_STATES: ReadonlySet<string> = new Set<PluginStatusSummary["state"]>([
  "ready",
  "attention",
  "progress",
  "off",
  "unknown",
]);
const VERSION_STATES: ReadonlySet<string> = new Set<PluginStatusVersion["state"]>([
  "installed",
  "preparing",
  "failed",
  "missing",
  "unsupported",
  "unknown",
]);
const CHECK_STATES: ReadonlySet<string> = new Set<PluginStatusCheck["state"]>([
  "ok",
  "action",
  "unknown",
  "na",
]);

type Loose = Record<string, unknown>;

const isLoose = (v: unknown): v is Loose =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The string fields of `from` named in `keys`, each kept only when it is a string. */
function strings<K extends string>(from: Loose, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = from[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

const stateOf = <S extends string>(value: unknown, known: ReadonlySet<string>): S =>
  (typeof value === "string" && known.has(value) ? value : "unknown") as S;

function summaryOf(raw: unknown): PluginStatusSummary | undefined {
  if (!isLoose(raw) || typeof raw.text !== "string") return undefined;
  return {
    state: stateOf(raw.state, SUMMARY_STATES),
    text: raw.text,
    ...strings(raw, ["textZh", "hint", "hintZh"] as const),
  };
}

function versionOf(raw: unknown): PluginStatusVersion | undefined {
  if (!isLoose(raw) || typeof raw.name !== "string") return undefined;
  const progress =
    typeof raw.progress === "number" && Number.isFinite(raw.progress)
      ? Math.min(1, Math.max(0, raw.progress))
      : undefined;
  return {
    name: raw.name,
    state: stateOf(raw.state, VERSION_STATES),
    ...strings(raw, [
      "version",
      "platform",
      "text",
      "textZh",
      "details",
      "detailsZh",
      "action",
    ] as const),
    ...(progress !== undefined ? { progress } : {}),
  };
}

function checkOf(raw: unknown): PluginStatusCheck | undefined {
  if (!isLoose(raw) || typeof raw.id !== "string" || typeof raw.label !== "string") {
    return undefined;
  }
  return {
    id: raw.id,
    label: raw.label,
    state: stateOf(raw.state, CHECK_STATES),
    ...strings(raw, ["labelZh", "text", "textZh", "details", "detailsZh", "action"] as const),
  };
}

/** The report as the page may read it; undefined when nothing of it holds. */
export function normalizeReport(raw: unknown): PluginStatusReport | undefined {
  if (!isLoose(raw)) return undefined;
  const summary = summaryOf(raw.summary);
  const version = versionOf(raw.version);
  const checks = Array.isArray(raw.checks)
    ? raw.checks.map(checkOf).filter((c): c is PluginStatusCheck => c !== undefined)
    : [];
  const recheck = typeof raw.recheck === "string" ? raw.recheck : undefined;
  if (
    summary === undefined &&
    version === undefined &&
    checks.length === 0 &&
    recheck === undefined
  ) {
    return undefined;
  }
  return {
    ...(summary !== undefined ? { summary } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    ...(recheck !== undefined ? { recheck } : {}),
  };
}
