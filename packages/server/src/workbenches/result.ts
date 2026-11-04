/** A workbench reads the latest task's answer, never an earlier answer or a child's output. */
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { WorkbenchResult } from "../mechanisms/workbenches.js";

export function workbenchResult(status: string, messages: readonly AmspRecord[]): WorkbenchResult {
  if (status !== "idle") return { status: "running", text: "", error: null };
  let text = "";
  let error: string | null = null;
  // Walking backward, a Request's request_end comes before its texts: the text of a Request
  // that did not complete (a retried, interrupted or failed attempt) is no answer.
  let inCompletedRequest = true;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if ((message.origin?.length ?? 0) > 0) continue;
    const p = message.payload;
    if (!("type" in p)) continue;
    if (p.type === "text" && p.role === "user") break;
    if (p.type === "abort") error ??= p.error_message ?? p.reason ?? "Task aborted";
    if (p.type === "request_end") {
      inCompletedRequest = p.status === "completed";
      if (!inCompletedRequest && text === "") error ??= p.error_message ?? `Request ${p.status}`;
    }
    if (p.type === "text" && p.role === "assistant" && inCompletedRequest && text === "")
      text = p.text;
  }
  return error !== null || text === ""
    ? { status: "failed", text: "", error: error ?? "The task ended without an answer." }
    : { status: "completed", text, error: null };
}
