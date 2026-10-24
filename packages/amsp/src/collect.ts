/**
 * What a run comes to once its stream has ended, read from its records.
 *
 * A run stream carries no verdict of its own: `[DONE]` only says it is over. The outcome is in
 * the records, decided in this order:
 *
 * 1. the main Session's last `task_begin` has no `task_end` (or the run began no Task at all) —
 *    the run did not reach its end, which is a failure of the server's: `fatal`, `internal`;
 * 2. the main Session recorded an `abort`: `aborted`, with its cause (the turn cap's is
 *    `max_turns`);
 * 3. the main Session's last `request_end` or `compaction_end` that is not `completed` and plans
 *    no retry (no `retry_in_ms`), unless a later request went on: its status and error (a
 *    response the retries never got past its output cap is `retryable`, `output_truncated`);
 * 4. otherwise `completed`.
 *
 * The text is the main Session's assistant text of the Requests that completed: a Request that
 * was retried, interrupted or failed contributes none, though its texts have their records. Child Sessions' records (with `origin`) never
 * decide the outcome; their usage counts.
 */
import { AmspStreamError } from "./errors.js";
import type {
  AbortPayload,
  AmspError,
  AmspRecord,
  CompactionEndPayload,
  RequestEndPayload,
  SessionMetaPayload,
  StopReason,
  TextPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallPayload,
} from "./types.js";

/** A finished run, as `Run.result()` and `AgentClient.run()` return it. */
export interface RunResult {
  /** `completed`, or how the run stopped. */
  status: StopReason;
  /** Why the run did not complete, when a record says. */
  error?: AmspError;
  /** The Session the run ran on; pass it as `sessionId` to continue the conversation. */
  sessionId: string;
  /** The main Session's assistant texts of the Requests that completed, joined with a blank line; a compaction's summary is not among them. */
  text: string;
  /** The tokens every Request of the run counted, its subagents' included: the sum of `token_usage.request`. */
  usage: TokenCounts;
  /** The main Session's cumulative count as last reported; null when no request reported one. */
  sessionUsage: TokenCounts | null;
  /** Model Requests the main Session issued in this run, retried attempts included. */
  requests: number;
}

const isMain = (rec: AmspRecord): boolean => rec.origin === undefined || rec.origin.length === 0;

const payloadType = (rec: AmspRecord): string => (rec.payload as { type?: string }).type ?? "";

const zero = (): TokenCounts => ({ cache_read: 0, cache_write: 0, output: 0, total: 0 });

function errorOf(p: { error_code?: string; error_message?: string }): AmspError | undefined {
  if (p.error_code === undefined && p.error_message === undefined) return undefined;
  return { code: p.error_code ?? "unknown", message: p.error_message ?? "" };
}

/**
 * Folds a run's records, in stream order, into its {@link RunResult}. `AgentClient` uses it; a
 * program that reads a run's body itself — with its own `fetch`, its own credentials, its own
 * URL — feeds it the records `readAmsp` yields, and gets the same result.
 *
 * The Session the run is on is the `sessionId` given here when the run continued one; a run that
 * started a new Session is named by that Session's `session_meta`, its stream's first record.
 */
export class RunCollector {
  #sessionId: string | null = null;
  /** The main Session's Task state: none begun yet, one open, or the last one closed. */
  #task: "none" | "open" | "closed" = "none";
  #abort: AmspError | null = null;
  #terminal: { status: StopReason; error?: AmspError } | null = null;
  #compacting = false;
  readonly #texts: string[] = [];
  /** The open Request's assistant texts: kept once its request_end is `completed`. */
  #requestTexts: string[] = [];
  #usage = zero();
  #sessionUsage: TokenCounts | null = null;
  #requests = 0;

  /** `sessionId`: the Session the run continued, as its request's `session_id` named it. */
  constructor(opts: { sessionId?: string } = {}) {
    this.#sessionId = opts.sessionId ?? null;
  }

  /** The Session the run is on; null until a new Session's `session_meta` has been added. */
  get sessionId(): string | null {
    return this.#sessionId;
  }

  add(rec: AmspRecord): void {
    if (rec.type === "session_meta") {
      // The main Session's first meta names a new Session; a new context's is the same Session's.
      if (isMain(rec)) this.#sessionId ??= (rec.payload as SessionMetaPayload).session_id;
      return;
    }
    const type = payloadType(rec);
    if (type === "token_usage") {
      const p = rec.payload as TokenUsagePayload;
      if (p.request) {
        const u = this.#usage;
        this.#usage = {
          cache_read: u.cache_read + p.request.cache_read,
          cache_write: u.cache_write + p.request.cache_write,
          output: u.output + p.request.output,
          total: u.total + p.request.total,
        };
      }
      if (isMain(rec) && p.session) this.#sessionUsage = { ...p.session };
      return;
    }
    if (!isMain(rec)) return;
    switch (type) {
      case "task_begin":
        this.#task = "open";
        return;
      case "task_end":
        this.#task = "closed";
        return;
      case "abort": {
        const p = rec.payload as AbortPayload;
        this.#abort = {
          code: p.error_code ?? "user_abort",
          message: p.error_message ?? p.reason ?? "The run was interrupted.",
        };
        return;
      }
      case "request_begin":
        this.#requests += 1;
        this.#requestTexts = [];
        // The run went on: a failure that was not its end (a compaction at a Task boundary).
        this.#terminal = null;
        return;
      case "request_end": {
        const p = rec.payload as RequestEndPayload;
        if (p.status === "completed") this.#texts.push(...this.#requestTexts);
        this.#requestTexts = [];
        if (p.status !== "completed" && p.retry_in_ms === undefined) {
          const error = errorOf(p);
          this.#terminal = { status: p.status, ...(error ? { error } : {}) };
        }
        return;
      }
      case "compaction_begin":
        this.#compacting = true;
        return;
      case "compaction_end": {
        this.#compacting = false;
        const p = rec.payload as CompactionEndPayload;
        if (p.status !== "completed") {
          const error = errorOf(p);
          this.#terminal = { status: p.status, ...(error ? { error } : {}) };
        }
        return;
      }
      case "text": {
        const p = rec.payload as TextPayload;
        if (p.role !== "assistant" || this.#compacting) return;
        if (p.text !== "") this.#requestTexts.push(p.text);
        return;
      }
    }
  }

  /**
   * The result of a stream that reached `[DONE]`; an {@link AmspStreamError} when the run
   * neither continued a given Session nor carried a new one's `session_meta`, since then nothing
   * says what the records belong to.
   */
  result(): RunResult {
    if (this.#sessionId === null) {
      throw new AmspStreamError(
        "The stream ended without the session_meta that names its new Session.",
      );
    }
    const outcome = this.#outcome();
    return {
      status: outcome.status,
      ...(outcome.error ? { error: outcome.error } : {}),
      sessionId: this.#sessionId,
      text: this.#texts.join("\n\n"),
      usage: { ...this.#usage },
      sessionUsage: this.#sessionUsage === null ? null : { ...this.#sessionUsage },
      requests: this.#requests,
    };
  }

  #outcome(): { status: StopReason; error?: AmspError } {
    if (this.#task !== "closed") {
      return {
        status: "fatal",
        error: {
          code: "internal",
          message:
            this.#task === "open"
              ? "The run did not reach its end: its last Task was never closed."
              : "The run began no Task.",
        },
      };
    }
    if (this.#abort !== null) return { status: "aborted", error: this.#abort };
    if (this.#terminal !== null) return this.#terminal;
    return { status: "completed" };
  }
}

/**
 * A tool call's arguments as an object. A record carries them as a JSON string: for a completed
 * call the engine's serialization of the parsed arguments, which the streamed fragments need not
 * match character for character but parse to the same object; for a call cut short, the text
 * received so far. An empty string is a call without arguments (`{}`), and anything that does not
 * parse to a JSON object is `null`.
 */
export function parseArguments(
  toolCall: Pick<ToolCallPayload, "arguments">,
): Record<string, unknown> | null {
  if (toolCall.arguments.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(toolCall.arguments);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
