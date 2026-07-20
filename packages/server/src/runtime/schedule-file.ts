/**
 * Schedule file parsing, validation, and trigger-time computation.
 *
 * `agent_state/schedule/<name>.toml` is declarative intent; the system never writes it
 * back. This module does pure parsing and pure time math only: an invalid file returns
 * an error (the scheduler skips it and records the error); runtime state (fired /
 * missed / disabled) doesn't live here — it belongs to SQLite (db/repos/schedules.ts).
 * Docs: /docs/configuration § "Schedules".
 */
import { parse as parseToml } from "smol-toml";

/** `period` lower bound: below 5 minutes is treated as an invalid file (guards against runaway high-frequency tasks). */
export const MIN_PERIOD_MS = 5 * 60_000;

/** A parsed schedule definition (the filename minus `.toml` is its identity). */
export interface ScheduleDefinition {
  name: string;
  /** The Prompt to send (required). */
  prompt: string;
  /** Enabled switch; disabled by default. */
  enabled: boolean;
  /** Original text of the first trigger time (for API echo, preserving the written form). */
  startAt: string;
  /** First trigger time (epoch ms). */
  startAtMs: number;
  /** Original text of the end time. */
  endAt?: string;
  /** Original text of the trigger period (e.g. `30m`, for API echo); undefined means a one-shot task. */
  period?: string;
  /** Trigger period (ms); undefined means a one-shot task. */
  periodMs?: number;
  /** End time (epoch ms); no more triggers once past it. */
  endAtMs?: number;
  /** The target Session to bind to; defaults to creating a new Session each time. */
  sessionId?: string;
  /** Workspace for new-Session mode (same semantics as manually starting a session; auto-creates a temp directory if unspecified). */
  workspace?: string;
  /** Model for new-Session mode (upstream id, paired with provider; defaults to the Project's default reference). */
  modelId?: string;
  /**
   * Vendor grouping for `model_id` (paired reference); when omitted, resolved per
   * resolveModelRef semantics — whether the reference is resolvable is validated by the
   * caller against config at reconciliation/save time (this module does pure parsing
   * and never touches config).
   */
  provider?: string;
}

export type ScheduleParseResult =
  { ok: true; def: ScheduleDefinition } | { ok: false; error: string };

/** Parse a fixed interval in `30m` / `12h` / `7d` form; returns null if invalid. */
export function parsePeriod(raw: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  const unit = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
  return n * unit;
}

/** Parse an ISO 8601 instant into epoch ms plus the original text for echo; returns null if invalid (smol-toml's date values are also accepted). */
function parseInstant(value: unknown): { ms: number; raw: string } | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : { ms, raw: value.toISOString() };
  }
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : { ms, raw: value };
}

/**
 * Parse and validate a schedule file. A field with the wrong type invalidates the whole
 * file (the baseline for hand-edit tolerance is to never let bad config reach the
 * scheduler); unknown keys are ignored (forward compatibility).
 */
export function parseScheduleFile(name: string, raw: string): ScheduleParseResult {
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse TOML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object")
    return { ok: false, error: "Content is not a TOML table" };
  const t = parsed as Record<string, unknown>;

  const prompt = t["prompt"];
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { ok: false, error: "Missing required field prompt" };
  }
  const enabled = t["enabled"] === undefined ? false : t["enabled"];
  if (typeof enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };

  const startAt = parseInstant(t["start_at"]);
  if (startAt === null)
    return { ok: false, error: "start_at is missing or not a valid ISO 8601 instant" };

  let period: string | undefined;
  let periodMs: number | undefined;
  if (t["period"] !== undefined) {
    if (typeof t["period"] !== "string") return { ok: false, error: "period must be a string" };
    const ms = parsePeriod(t["period"]);
    if (ms === null) return { ok: false, error: "period must look like 30m / 12h / 7d" };
    if (ms < MIN_PERIOD_MS) return { ok: false, error: "period is below the 5m minimum" };
    period = t["period"].trim();
    periodMs = ms;
  }

  let endAt: { ms: number; raw: string } | undefined;
  if (t["end_at"] !== undefined) {
    const parsedEnd = parseInstant(t["end_at"]);
    if (parsedEnd === null) return { ok: false, error: "end_at is not a valid ISO 8601 instant" };
    if (parsedEnd.ms <= startAt.ms)
      return { ok: false, error: "end_at must be later than start_at" };
    endAt = parsedEnd;
  }

  let sessionId: string | undefined;
  if (t["session_id"] !== undefined) {
    if (typeof t["session_id"] !== "string" || t["session_id"] === "") {
      return { ok: false, error: "session_id must be a non-empty string" };
    }
    sessionId = t["session_id"];
  }
  let workspace: string | undefined;
  if (t["workspace"] !== undefined) {
    if (typeof t["workspace"] !== "string" || t["workspace"] === "") {
      return { ok: false, error: "workspace must be a non-empty string" };
    }
    workspace = t["workspace"];
  }
  let modelId: string | undefined;
  if (t["model_id"] !== undefined) {
    if (typeof t["model_id"] !== "string" || t["model_id"] === "") {
      return { ok: false, error: "model_id must be a non-empty string" };
    }
    modelId = t["model_id"];
  }
  let provider: string | undefined;
  if (t["provider"] !== undefined) {
    if (typeof t["provider"] !== "string" || t["provider"] === "") {
      return { ok: false, error: "provider must be a non-empty string" };
    }
    provider = t["provider"];
  }
  if (provider !== undefined && modelId === undefined) {
    return {
      ok: false,
      error:
        "provider is only used together with model_id (a model reference must be given as a pair)",
    };
  }
  if (
    sessionId !== undefined &&
    (workspace !== undefined || modelId !== undefined || provider !== undefined)
  ) {
    return {
      ok: false,
      error: "Pick one target: workspace and provider / model_id are only for new-Session mode",
    };
  }

  return {
    ok: true,
    def: {
      name,
      prompt,
      enabled,
      startAt: startAt.raw,
      startAtMs: startAt.ms,
      ...(period !== undefined ? { period } : {}),
      ...(periodMs !== undefined ? { periodMs } : {}),
      ...(endAt !== undefined ? { endAt: endAt.raw, endAtMs: endAt.ms } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(modelId !== undefined ? { modelId } : {}),
      ...(provider !== undefined ? { provider } : {}),
    },
  };
}

/**
 * Step from `start_at` by `period` and return the most recent scheduled time not later
 * than `nowMs`; null if `start_at` hasn't been reached yet. A one-shot task's only slot
 * is `start_at` itself.
 */
export function latestSlotAt(def: ScheduleDefinition, nowMs: number): number | null {
  if (nowMs < def.startAtMs) return null;
  if (def.periodMs === undefined) return def.startAtMs;
  const k = Math.floor((nowMs - def.startAtMs) / def.periodMs);
  return def.startAtMs + k * def.periodMs;
}

/** Whether a scheduled slot still falls within the `[start_at, end_at]` window (always true if there's no end_at). */
export function slotInWindow(def: ScheduleDefinition, slotMs: number): boolean {
  return def.endAtMs === undefined || slotMs <= def.endAtMs;
}

/**
 * The next scheduled time strictly after `nowMs` (used to display "next trigger");
 * for a one-shot task this only has a value while start_at hasn't been reached, and
 * returns null once past end_at.
 */
export function nextSlotAfter(def: ScheduleDefinition, nowMs: number): number | null {
  let next: number;
  if (nowMs < def.startAtMs) {
    next = def.startAtMs;
  } else if (def.periodMs === undefined) {
    return null;
  } else {
    const k = Math.floor((nowMs - def.startAtMs) / def.periodMs) + 1;
    next = def.startAtMs + k * def.periodMs;
  }
  return slotInWindow(def, next) ? next : null;
}
