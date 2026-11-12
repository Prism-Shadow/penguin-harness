/**
 * The state machine of one summarize compaction: the requests it sends, the budgets that bound
 * them, and how it ends. A free generator over a host — the engine, which owns the LLM object,
 * the Trace and the Environment — so the loop holds no engine state.
 *
 * Every request only appends to the history the one before it left. Each committed response is
 * one of three (see classifyCompactionResponse): a **summary**, a **round** (tool calls and no
 * tagged summary) or **empty**. A summary's own tool calls are answered and nothing more is
 * sent. A round's calls are answered — run while a round is open (`maxRounds`, and the window
 * below `roundLimit`), refused otherwise — and their outputs go out behind a round line. A
 * refused round and an empty response are corrections, answered with a corrective line; so is a
 * response cut at the output limit, asked again with the same input and one line more. A
 * refusal over images is sent again with the images replaced, outside every budget. Transport
 * failures retry on the backoff ladder (`maxReconnects`); a `fatal` one ends the loop.
 * Docs: /docs/agent-loop § "Compaction".
 */
import { SALVAGE_MIN_CHARS, extractSummary, summaryInTags } from "@prismshadow/amsp/markers";
import type { AmspRecord, ErrorCode, ToolCallPayload } from "@prismshadow/amsp/records";
import type { LLMOutcome } from "../interfaces/index.js";
import type { SpanCall, SpanRequest } from "./compaction-carry.js";
import { CLOSED_LINE, EMPTY_LINE, TRUNCATED_LINE, roundLine } from "./compaction-lines.js";
import { hasInputImages, replaceInputImages } from "./rejected-images.js";

/** Responses that advanced nothing and are answered with a corrective line, per compaction. */
const MAX_COMPACTION_CORRECTIONS = 2;

/** How one compaction request ended, with its complete text and its real tool calls. */
export interface CompactionResponse extends LLMOutcome {
  text: string;
  toolCalls: AmspRecord<ToolCallPayload>[];
}

/** What the loop needs from the engine. */
export interface CompactionLoopHost {
  /** Writes a harness line (the Prompt, a round line, a corrective line) to the closing Trace and returns its record. */
  line(text: string): Promise<AmspRecord>;
  /** Sends one request: `attempts` is its ordinal, `retryInMs` the wait its request_end announces. */
  request(
    input: AmspRecord[],
    attempts: number,
    retryInMs: (outcome: LLMOutcome) => number | undefined,
  ): AsyncGenerator<AmspRecord, CompactionResponse>;
  /** Answers every call of a committed response: gate → approve → Environment when `open`, refused otherwise. */
  answer(
    calls: AmspRecord<ToolCallPayload>[],
    open: boolean,
  ): AsyncGenerator<AmspRecord, SpanCall[]>;
  /** The transport backoff before retry n (false: the user stopped it). */
  backoff(n: number): Promise<boolean>;
  /** The wait to announce for transport retry n (undefined past the budget). */
  retryDelayMs(n: number): number | undefined;
  /** The context's size by the latest token_usage: what `roundLimit` is compared with. */
  contextTotal(): number;
  signal?: AbortSignal | undefined;
}

/** The loop's budgets and its Prompt. */
export interface CompactionLoopSettings {
  prompt: string;
  /** Tool rounds the compaction may take (0: none — every tool call is refused). */
  maxRounds: number;
  /** No round is open once the context reaches this many tokens. Absent: no limit. */
  roundLimit?: number | undefined;
  /** Transport-class retries, across the whole compaction. */
  maxReconnects: number;
}

export interface CompactionLoopResult {
  /** A summary, a fallback with the reason for it, or a stop (also one that lands before the fallback). */
  end: { summary: string } | { errorCode: ErrorCode; errorMessage?: string } | "aborted";
  /** Requests that were not rounds: the ordinal the compaction_end carries. */
  attempts: number;
  /**
   * What the old context is still owed: the folded input until a response is committed by MMSP
   * — it then lives in the old object's history and must never be resent (issue #85) — then
   * the outputs answering the latest committed response's calls.
   */
  pending: AmspRecord[];
  /** What each request produced (for the salvage). */
  requests: SpanRequest[];
  /** Every call of a committed response with its output (for the opening's record of them). */
  calls: SpanCall[];
}

/**
 * Runs one summarize compaction's requests. The first request's input is `folded` (the
 * triggering turn's tool results mid-Task, or leftover carry-over) and the Prompt as one user
 * turn — an unanswered tool_use would get the compaction request itself rejected (issue #33).
 */
export async function* runCompactionLoop(
  host: CompactionLoopHost,
  settings: CompactionLoopSettings,
  folded: AmspRecord[],
): AsyncGenerator<AmspRecord, CompactionLoopResult> {
  const requests: SpanRequest[] = [];
  const calls: SpanCall[] = [];
  let pending = folded;
  let rounds = 0;
  let corrections = 0;
  let transport = 0;
  let truncatedLine: AmspRecord | null = null;
  // `uncounted`: a stop while a committed response's calls are answered does not count that
  // response as an attempt.
  const finish = (end: CompactionLoopResult["end"], uncounted = 0): CompactionLoopResult => ({
    end: end !== "aborted" && !("summary" in end) && host.signal?.aborted ? "aborted" : end,
    attempts: requests.length - rounds - uncounted,
    pending,
    requests,
    calls,
  });
  const roundOpen = (): boolean =>
    rounds < settings.maxRounds &&
    (settings.roundLimit === undefined || host.contextTotal() < settings.roundLimit);
  // The wait announced on a request's request_end before the loop sends again (0: at once),
  // undefined when it will not: mirrors the branches below, or the countdown is a lie.
  const retryInMs = (o: LLMOutcome): number | undefined => {
    if (o.status === "fatal") return undefined;
    if (o.errorCode === "output_truncated") {
      return corrections < MAX_COMPACTION_CORRECTIONS ? 0 : undefined;
    }
    return o.status === "retryable" ? host.retryDelayMs(transport + 1) : undefined;
  };

  let input = [...folded, await host.line(settings.prompt)];
  for (;;) {
    if (host.signal?.aborted) return finish("aborted");
    const open = roundOpen();
    const r = yield* host.request(input, requests.length - rounds, retryInMs);
    requests.push(r);
    if (r.status === "completed") {
      pending = [];
      const kind = classifyCompactionResponse(r.text, r.toolCalls.length > 0);
      if (kind === "empty") {
        if (++corrections > MAX_COMPACTION_CORRECTIONS) {
          return finish({
            errorCode: "malformed",
            errorMessage: "the response contained no usable summary",
          });
        }
        input = [await host.line(EMPTY_LINE)];
        continue;
      }
      if (r.toolCalls.length > 0) {
        const answered = yield* host.answer(r.toolCalls, open);
        calls.push(...answered);
        pending = answered.map((c) => c.output!);
        if (host.signal?.aborted) return finish("aborted", 1);
      }
      if (kind === "summary") return finish({ summary: extractSummary(r.text) });
      if (open) {
        rounds += 1;
        input = [...pending, await host.line(roundLine(rounds, settings.maxRounds, roundOpen()))];
        continue;
      }
      if (++corrections > MAX_COMPACTION_CORRECTIONS) {
        return finish({
          errorCode: "malformed",
          errorMessage: "the response called tools instead of writing a summary",
        });
      }
      input = [...pending, await host.line(CLOSED_LINE)];
      continue;
    }
    if (r.status === "aborted") return finish("aborted");
    // Not committed: the input is still owed in full, so every resend below starts from it.
    const failure = {
      errorCode: r.errorCode ?? "malformed",
      ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
    };
    if (r.status === "fatal") return finish(failure);
    if (r.errorCode === "image_rejected" && hasInputImages(input)) {
      // The turn loop's image rule: each image of the refused input becomes the fixed note.
      input = replaceInputImages(input);
      continue;
    }
    if (r.errorCode === "output_truncated") {
      // A correction, not a transient fault: asked again at once, with one line more.
      if (++corrections > MAX_COMPACTION_CORRECTIONS) return finish(failure);
      truncatedLine ??= await host.line(TRUNCATED_LINE);
      if (input.at(-1) !== truncatedLine) input = [...input, truncatedLine];
      continue;
    }
    if (transport >= settings.maxReconnects) return finish(failure);
    transport += 1;
    if (!(await host.backoff(transport))) return finish("aborted");
  }
}

/**
 * What a committed compaction response is. Text only: a summary unless it extracts empty — the
 * lenient rule, which accepts a tagless reply. With tool calls: a summary only when it holds a
 * tagged one (closed, or long enough to salvage), otherwise a round, its text a preamble.
 */
function classifyCompactionResponse(
  text: string,
  calledTools: boolean,
): "summary" | "round" | "empty" {
  if (!calledTools) return extractSummary(text) !== "" ? "summary" : "empty";
  const tagged = summaryInTags(text);
  return tagged !== null &&
    tagged.text !== "" &&
    (tagged.closed || tagged.text.length >= SALVAGE_MIN_CHARS)
    ? "summary"
    : "round";
}
