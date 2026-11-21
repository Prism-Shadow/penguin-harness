/**
 * Reading the Task records (`task_begin` / `task_end`, see TaskBeginPayload) back out of a
 * message sequence.
 *
 * Task records are written by the Session straight to the current Trace file and never open a
 * new one. When a Task ends on a completed compaction, its `task_end` — and the next Task's
 * `task_begin` — therefore land in the old file, behind the `compaction_end` that closed it:
 * the summary exists only there until the next context's first message opens the new file.
 * Whether a file's context is closed is therefore read past them (see context-state.ts), so a
 * restart in that window still finds the summary.
 *
 * Browser-safe: the Web App reads the same records off the same envelopes.
 */
import { isEventMessage } from "./types.js";
import type { AmspRecord } from "./types.js";

/** Whether `msg` is a `task_begin` or a `task_end` (of any Session — origin is not checked). */
export function isTaskRecord(msg: AmspRecord): boolean {
  if (!isEventMessage(msg)) return false;
  const t = (msg.payload as { type?: string }).type;
  return t === "task_begin" || t === "task_end";
}

/** Whether `msg` is a `task_begin` (of any Session — origin is not checked). */
export function isTaskBegin(msg: AmspRecord): boolean {
  return isEventMessage(msg) && (msg.payload as { type?: string }).type === "task_begin";
}
