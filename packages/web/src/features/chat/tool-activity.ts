import type { RunState, ToolCallDuration } from "@prismshadow/penguin-ui";
import { localWorkTime, type ToolCallItem } from "../../lib/amsp/stream-model";
import { S } from "../../lib/strings";

/** State and clock shared by the tool's detail card and its compact step header. */
export function toolActivity(item: ToolCallItem, pending: boolean) {
  const executing = item.callComplete && !item.outputComplete && !pending;
  // Argument-generation segment (settled): the live execution timer accumulates on top of this as a baseline, so the displayed duration doesn't shrink back once output arrives.
  const genMs =
    item.argStartedAtMs !== undefined && item.callStartedAtMs !== undefined
      ? Math.max(0, item.callStartedAtMs - item.argStartedAtMs)
      : 0;
  const failed = item.outputStatus !== undefined && item.outputStatus !== "completed";
  const state: RunState = pending
    ? "waiting"
    : executing || item.callStreaming
      ? "running"
      : failed
        ? "failed"
        : "done";
  // Decision wording ("Approved · manual", "Denied · manual", …): carried ONLY by the status
  // icon's title/aria-label — per review the row shows no visible decision text at any
  // breakpoint; the icon is the single source of truth for how the call was decided.
  const decisionText = item.decision
    ? `${item.decision === "allow" ? S.chat.decisionAllow : S.chat.decisionDeny} · ${
        item.decision === "forbidden"
          ? S.chat.decisionPolicy
          : item.decisionSource === "manual"
            ? S.chat.decisionManual
            : S.chat.decisionAuto
      }`
    : null;
  // A denial reports status "aborted" on the output it feeds back — a person's "deny" and the
  // command policy's "forbidden" alike; that abort IS the decision, so the icon reads
  // "Denied · …" (the label's second half names the decider) rather than falling through to
  // the raw status. A call interrupted while running (or cut short while streaming) carries no
  // deny decision, so the label falls through to its status below.
  const denied =
    (item.decision === "deny" || item.decision === "forbidden") && item.outputStatus === "aborted";
  const stateLabel = pending
    ? S.chat.approvalWaiting
    : state === "running"
      ? S.chat.workRunning
      : state === "done"
        ? (decisionText ?? S.chat.workDone)
        : denied
          ? (decisionText ?? undefined)
          : item.outputStatus;
  // Total duration = argument generation + execution, excluding the approval wait: settled once
  // known; while executing, a live segment from the approval grant (or from call completion when
  // no approval was needed) on top of the generation baseline; while waiting on approval, frozen
  // at the settled generation segment; while the arguments stream, a live clock from their start
  // (an ellipsis when no start time is known).
  const duration: ToolCallDuration | undefined =
    item.durationMs !== undefined
      ? { live: false, ms: item.durationMs }
      : executing
        ? {
            live: true,
            sinceMs: localWorkTime(item, item.approvalAtMs ?? item.callStartedAtMs),
            offsetMs: genMs,
          }
        : pending
          ? genMs > 0
            ? { live: false, ms: genMs }
            : undefined
          : item.callStreaming
            ? { live: true, sinceMs: localWorkTime(item, item.argStartedAtMs) }
            : undefined;
  return { state, stateLabel, duration };
}
