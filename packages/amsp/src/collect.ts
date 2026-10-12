/**
 * What a run comes to once its stream has ended: the outcome `run.done` reports, the complete
 * items, and the answer as text.
 */
import { AmspStreamError } from "./errors.js";
import type {
  AmspError,
  AmspEvent,
  ApprovalRequested,
  RunDone,
  StopReason,
  TokenCounts,
  ToolCallDone,
} from "./types.js";

/** A finished run, as `Run.result()` and `AgentClient.ask()` return it. */
export interface RunResult {
  /** `run.done.status`: `completed`, or how the run stopped. */
  status: StopReason;
  /** `run.done.error`, when the run did not complete. */
  error?: AmspError;
  /** The Session the run ran on; pass it as `sessionId` to continue the conversation. */
  sessionId: string;
  /** The main Session's assistant `text.done` items, joined with a blank line. */
  text: string;
  /**
   * Every event but the `.delta` fragments, in stream order: complete items and run, request,
   * approval and compaction events alike. A compaction summary the engine streamed has no
   * `summary.done` and so leaves no item here; the fragments are never rebuilt into one.
   */
  items: AmspEvent[];
  /** `run.done.usage`: the tokens every Request of this run counted. */
  usage: TokenCounts;
  /** `run.done.session_usage`: the Session's cumulative count; null when the engine reported none. */
  sessionUsage: TokenCounts | null;
  /** `run.done.requests`: model Requests this run issued, retried attempts included. */
  requests: number;
}

/**
 * Folds a run's events, in stream order, into its {@link RunResult}. `AgentClient` uses it; a
 * program that reads a run's body itself — with its own `fetch`, its own credentials, its own
 * URL — feeds it what `readSse` yields, parsed, and gets the same result.
 */
export class RunCollector {
  #sessionId: string | null = null;
  #done: RunDone | null = null;
  readonly #texts: string[] = [];
  readonly #items: AmspEvent[] = [];

  add(event: AmspEvent): void {
    if (event.type.endsWith(".delta")) return;
    this.#items.push(event);
    if (event.type === "run.started") {
      this.#sessionId ??= event.session_id;
    } else if (event.type === "run.done") {
      this.#done ??= event;
    } else if (
      event.type === "text.done" &&
      event.role === "assistant" &&
      !event.origin?.length &&
      event.text !== ""
    ) {
      this.#texts.push(event.text);
    }
  }

  /** Whether `run.done` has arrived: the run's outcome is known. */
  get finished(): boolean {
    return this.#done !== null;
  }

  /** The result; an {@link AmspStreamError} when the stream never told how the run ended. */
  result(): RunResult {
    const done = this.#done;
    if (done === null || this.#sessionId === null) {
      throw new AmspStreamError(
        "The stream ended before run.done: the connection broke or the server failed.",
      );
    }
    return {
      status: done.status,
      ...(done.error ? { error: done.error } : {}),
      sessionId: this.#sessionId,
      text: this.#texts.join("\n\n"),
      items: this.#items,
      usage: done.usage,
      sessionUsage: done.session_usage,
      requests: done.requests,
    };
  }
}

/**
 * A tool call's arguments as an object. AMSP carries them as a JSON string: for a completed call
 * the engine's serialization of the parsed arguments, which the streamed fragments need not match
 * character for character but parse to the same object; for a call cut short, the text received
 * so far. An empty string is a call without arguments (`{}`), and anything that does not parse to
 * a JSON object is `null`.
 */
export function parseArguments(
  item: ToolCallDone | ApprovalRequested["tool_call"],
): Record<string, unknown> | null {
  if (item.arguments.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(item.arguments);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
