/**
 * Decoder for the abort event's `reason` prose.
 *
 * The wire stays lean: an abort event carries only the English `reason` of record, and
 * the engine writes it from a fixed set of spellings, so render layers that want a
 * localized banner decode the cause here instead of growing the payload. Live streams
 * only ever produce the user-interruption spellings (abort marks a human interrupt; an
 * LLM or compaction failure's terminal record is its request_end / compaction_end) —
 * the failure spellings below are decoded for Traces written before that split.
 *
 * Unrecognized prose (a Trace from a build with different spellings) decodes as
 * `unknown` and must be rendered verbatim.
 */

/** Decoded cause of an abort event, for localized rendering. */
export type AbortCause =
  | { kind: "user_abort" }
  /** Legacy Traces only: the request died on a failure no retry can fix; `detail` is the provider's own text. */
  | { kind: "llm_fatal"; detail: string }
  /** Legacy Traces only: the reconnect ladder ran out; `detail` (when the final failure carried one) is the last error. */
  | { kind: "llm_retries_exhausted"; attempts: number; detail?: string }
  /** The user interrupted the wait between reconnect attempts. */
  | { kind: "backoff_interrupted" }
  /** The user interrupted a running compaction. */
  | { kind: "compaction_aborted" }
  /** Legacy Traces only: a mid-task compaction was given up. */
  | { kind: "compaction_failed" }
  /** Prose this decoder does not recognize — render `reason` as-is. */
  | { kind: "unknown"; reason: string | null };

const EXHAUSTED =
  /^(?:llm request|malformed response|reconnect) failed after (\d+) retries(?:: ([\s\S]*))?$/;

/** Decodes an abort event's `reason` into a renderable cause. */
export function parseAbortReason(reason: string | null | undefined): AbortCause {
  if (reason === "aborted by user" || reason === "user") return { kind: "user_abort" };
  if (reason === "aborted during reconnect backoff") return { kind: "backoff_interrupted" };
  if (reason === "aborted during compaction") return { kind: "compaction_aborted" };
  if (reason === "compaction failed") return { kind: "compaction_failed" };
  if (reason != null) {
    if (reason.startsWith("llm request error: ")) {
      return { kind: "llm_fatal", detail: reason.slice("llm request error: ".length) };
    }
    const exhausted = EXHAUSTED.exec(reason);
    if (exhausted) {
      return {
        kind: "llm_retries_exhausted",
        attempts: Number(exhausted[1]),
        ...(exhausted[2] !== undefined ? { detail: exhausted[2] } : {}),
      };
    }
  }
  return { kind: "unknown", reason: reason ?? null };
}
