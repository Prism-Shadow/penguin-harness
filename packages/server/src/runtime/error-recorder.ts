/**
 * Error persistence: errors caught on the server are all
 * written to error_records through here, for display on the stats dashboard. Shape
 * mirrors usage-recorder — persist only raw facts, leave aggregation to query time.
 *
 * **The classification (kind) criterion is "does a human need to step in"**, not where
 * the error originated:
 *
 * - `expected`: anticipated by the system, has a defined handling path, part of normal
 *   operation, no human needed — HTTP business errors (`HttpError`, mostly 4xx); LLM
 *   `timeout` / `malformed` (the engine already reconnects and retries); tool execution
 *   `failed` / `timeout` (the error is fed back to the model, and the Agent adjusts on
 *   its own).
 * - `unexpected`: shouldn't happen, usually a bug or a config/environment fault,
 *   **needs a human** — internal errors converged to 500; process crashes; runtime
 *   errors escaping from background tasks (Session drive / usage persistence / title
 *   generation / subagent registration); LLM `failed` (not retryable: auth failure,
 *   invalid params, etc.).
 * - User-initiated actions **are not errors** and are never recorded: request/tool
 *   `aborted` (user clicked "stop", or denied a tool).
 *
 * Determination: HTTP sources are inferred automatically from `HttpError` (preserving
 * existing behavior); other sources must pass `kind` explicitly at the capture site.
 * The frontend highlights unexpected by default; expected is still recorded without
 * losing information.
 *
 * Sources cover HTTP, Session drive, LLM requests, Environment (tool execution), usage
 * persistence, title generation, subagent registration, and process-level fallback;
 * among these, `llm` / `environment` errors are not expressed via throw (core converges
 * them into the message stream instead), and are fished out by stream-error-watcher from
 * the Session output stream.
 *
 * **This recorder never throws**: it's hooked onto app.onError, and throwing from
 * within it would turn error handling into infinite recursion; if persistence itself
 * fails (disk full / DB already closed, etc.), it's fine to drop that one record.
 *
 * **Short-window dedup (DEDUP_WINDOW_MS)**: error storms are the norm — someone scanning
 * the API produces a wall of 404s, or a tool fails repeatedly in a loop. Persisting each
 * one both write-amplifies and floods the table, and makes the dashboard's "most recent
 * 20" all the same error. So the same `(source, code, Project)` is persisted at most
 * once per window; repeats within the window are **dropped outright** (not persisted);
 * only an actual persist refreshes the timestamp, so a sustained storm leaves a steady
 * one record per window instead of being suppressed indefinitely.
 * **Tradeoff**: aggregate counts therefore **underestimate** — a storm of the same error
 * only counts once, check the logs for true frequency; in exchange, a single error storm
 * doesn't drown out error_records or the stats dashboard. The second line of defense is
 * ErrorsRepo's capacity cap. The dedup table (lastSeen) must stay bounded: past
 * DEDUP_KEYS_MAX, expired entries are cleared first, and if still over the limit the
 * whole table is cleared — better to miss some dedup than let it grow unbounded across
 * different error codes.
 */
import { formatLocalDate } from "../internal/dates.js";
import { HttpError } from "../http/errors.js";
import type { ErrorsRepo } from "../db/repos/errors.js";

/** Capture-site source (maps one-to-one to error_records.source). */
export type ErrorSource =
  | "http"
  | "session"
  | "llm"
  | "environment"
  | "usage"
  | "title"
  | "subagent"
  | "process"
  | "schedule";

/** Error classification: see file header — the criterion is "does a human need to step in". */
export type ErrorKind = "expected" | "unexpected";

/** Attribution context (all optional: the login endpoint has no Project, and process-level fallback has no request at all). */
export interface ErrorContext {
  projectId?: string;
  agentId?: string;
  sessionId?: string;
}

export interface ErrorRecordArgs {
  source: ErrorSource;
  /** The caught error (unknown: the value caught may not be an Error; failures from the message stream pass the reason text directly). */
  err: unknown;
  ctx?: ErrorContext;
  /** Semantic code (required for non-HTTP sources, e.g. session_run_failed); defaults to HttpError.code. */
  code?: string;
  /** HTTP status code; leave empty for non-HTTP sources. */
  status?: number;
  /** Explicit classification (see file header); defaults to inferring from `HttpError` — HTTP sources rely on this, other sources should pass it explicitly. */
  kind?: ErrorKind;
}

/** Message truncation length (keep only a readable summary; the full stack is still logged). */
export const MESSAGE_MAX = 500;

/** Short-window dedup window: the same (source, code, Project) is persisted at most once per window (see the file header's tradeoff). */
export const DEDUP_WINDOW_MS = 2000;

/** Cap on dedup table keys (bounded; over the limit, expired entries are cleared first, and if still over, the whole table is cleared). */
export const DEDUP_KEYS_MAX = 1000;

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MESSAGE_MAX ? raw.slice(0, MESSAGE_MAX) : raw;
}

export class ErrorRecorder {
  /** Dedup table: `source \0 code \0 projectId` → timestamp of the last **persist** (see file header). */
  private readonly lastSeen = new Map<string, number>();

  constructor(
    private readonly errors: ErrorsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Record an error (synchronous, fails silently; same-window duplicates are dropped outright, see file header). */
  record(args: ErrorRecordArgs): void {
    try {
      const http = args.err instanceof HttpError ? args.err : null;
      const now = this.now();
      const projectId = args.ctx?.projectId ?? null;
      const code = args.code ?? http?.code ?? "internal";
      // Short-window dedup: coarse-grained to "same kind of error for the same Project"; repeats within the window aren't persisted.
      if (this.deduped(`${args.source}\0${code}\0${projectId ?? ""}`, now.getTime())) return;
      this.errors.insert({
        ts: now.toISOString(),
        date: formatLocalDate(now),
        projectId,
        agentId: args.ctx?.agentId ?? null,
        sessionId: args.ctx?.sessionId ?? null,
        source: args.source,
        // Explicit classification takes priority; otherwise infer from HttpError (business error = expected, else unexpected).
        kind: args.kind ?? (http ? "expected" : "unexpected"),
        code,
        // Unexpected errors from HTTP sources are converged to 500 externally (matches handleError's response).
        status: args.status ?? http?.status ?? (args.source === "http" ? 500 : null),
        message: messageOf(args.err),
      });
    } catch {
      // See file header: if the recorder itself errors, dropping this one record is the only option — never rethrow.
    }
  }

  /** true if a same-kind error was already recorded within the window (drop it); otherwise register this persist timestamp and keep the dedup table bounded. */
  private deduped(key: string, nowMs: number): boolean {
    const last = this.lastSeen.get(key);
    if (last !== undefined && nowMs - last < DEDUP_WINDOW_MS) return true;
    this.lastSeen.set(key, nowMs);
    if (this.lastSeen.size > DEDUP_KEYS_MAX) this.evict(nowMs);
    return false;
  }

  /** Keep the dedup table bounded (see file header): clear expired entries first; if still over the limit (hundreds/thousands of distinct error codes erupting at once), clear it entirely. */
  private evict(nowMs: number): void {
    for (const [key, at] of this.lastSeen) {
      if (nowMs - at >= DEDUP_WINDOW_MS) this.lastSeen.delete(key);
    }
    if (this.lastSeen.size > DEDUP_KEYS_MAX) this.lastSeen.clear();
  }
}

/** Minimal dependency a capture site needs on the recorder (tests inject a fake; structurally matches SessionManager's UsageRecorderLike). */
export type ErrorSink = Pick<ErrorRecorder, "record">;
