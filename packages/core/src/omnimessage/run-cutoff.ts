import type { ErrorCode } from "./types.js";

/**
 * How a run was cut off early, with the unified error pair of the record that ended it.
 * `abort` is a user interruption (the abort event); `llm_failure` is a terminal
 * request_end (`fatal`, or `retryable` with no `retry_in_ms` — no retry planned, the run
 * ends there); `compaction_failure` is a compaction given up mid-task (tool outputs still
 * owed the model a follow-up turn — at a Task boundary the same event is advisory and the
 * run's work is complete).
 */
export interface RunCutoff {
  kind: "abort" | "llm_failure" | "compaction_failure";
  errorCode?: ErrorCode;
  errorMessage?: string;
  /** Legacy abort prose (Traces from before the unified error pair). */
  reason?: string;
}

/**
 * Watches one run's own stream layer and answers whether the run ended early — failures
 * emit no abort event, so consumers that must not treat a cut-off run as finished (the
 * goal loop re-firing rounds, a subagent round reporting completion) observe the terminal
 * records instead. The caller pre-filters to the observed layer (e.g. main-session
 * messages only, or one child hop) and feeds every payload; state is per run — use a
 * fresh observer for each.
 */
export class RunCutoffObserver {
  private awaitingFollowUpTurn = false;
  private found: RunCutoff | null = null;

  observe(payload: unknown): void {
    const p = payload as {
      type?: string;
      status?: string;
      retry_in_ms?: number;
      error_code?: ErrorCode;
      error_message?: string;
      reason?: string | null;
    };
    switch (p.type) {
      case "abort":
        this.found = {
          kind: "abort",
          ...(p.error_code !== undefined ? { errorCode: p.error_code } : {}),
          ...(p.error_message !== undefined ? { errorMessage: p.error_message } : {}),
          ...(typeof p.reason === "string" ? { reason: p.reason } : {}),
        };
        return;
      case "tool_call_output":
        this.awaitingFollowUpTurn = true;
        return;
      case "request_begin":
        this.awaitingFollowUpTurn = false;
        return;
      case "request_end":
        if (p.status === "fatal" || (p.status === "retryable" && p.retry_in_ms === undefined)) {
          this.found = {
            kind: "llm_failure",
            ...(p.error_code !== undefined ? { errorCode: p.error_code } : {}),
            ...(p.error_message !== undefined ? { errorMessage: p.error_message } : {}),
          };
        }
        return;
      case "compaction_end":
        // Legacy Traces spell the abandoned case "failed".
        if (
          (p.status === "retryable" || p.status === "fatal" || p.status === "failed") &&
          this.awaitingFollowUpTurn
        ) {
          this.found = {
            kind: "compaction_failure",
            ...(p.error_code !== undefined ? { errorCode: p.error_code } : {}),
            ...(p.error_message !== undefined ? { errorMessage: p.error_message } : {}),
          };
        }
        return;
      default:
        return;
    }
  }

  /** The cut-off that ended the run, or null while none has been observed. */
  get cutoff(): RunCutoff | null {
    return this.found;
  }
}
