/** A workbench reads the latest task's answer, never an earlier answer or a child's output. */
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { WorkbenchResult } from "../mechanisms/workbenches.js";

export function workbenchResult(status: string, messages: readonly OmniMessage[]): WorkbenchResult {
  if (status !== "idle") return { status: "running", text: "", error: null };
  let text = "";
  let error: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if ((message.origin?.length ?? 0) > 0) continue;
    const p = message.payload;
    if (!("type" in p)) continue;
    if (p.type === "text" && p.role === "user") break;
    if (p.type === "abort") error ??= p.error_message ?? p.reason ?? "Task aborted";
    if (p.type === "request_end" && p.status !== "completed" && text === "") {
      error ??= p.error_message ?? `Request ${p.status}`;
    }
    if (p.type === "text" && p.role === "assistant" && p.stop_reason === "completed" && text === "")
      text = p.text;
  }
  return error !== null || text === ""
    ? { status: "failed", text: "", error: error ?? "The task ended without an answer." }
    : { status: "completed", text, error: null };
}
