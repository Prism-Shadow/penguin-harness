/**
 * How many units a history window holds — a unit being what the server cuts windows by and
 * counts `tailLimit` / `limit` in: one Task, opened by a main-session user prompt (text or an
 * image), where the prompts of one send (a text and its images, or two sends with nothing
 * between them) open ONE unit. The first paint backfills older windows until the newest
 * TAIL_UNITS units are on screen, so it has to count exactly what the server counts, or a
 * prompt with images reads as two Tasks and the conversation opens short of its 20 pairs.
 *
 * This mirrors the server's window scanner (server/src/services/message-window.ts,
 * `scanMessages`: `onTaskStart`, `breakRuns`, the steering, notice and compaction rules)
 * decision for decision, for the one count the page needs; the two must stay in step. A window
 * starts at a unit boundary, so the scan starts from a fresh state. Origin-tagged records (a
 * subagent's, expanded into the window) and Task records are skipped, as the scanner skips them.
 */
import { isTaskRecord } from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import {
  parseBackgroundTaskDoneMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseUserSteeringText,
} from "@prismshadow/amsp/markers";

/** Retryable ends render a reconnect hint, which breaks the run (legacy spellings included). */
const HINT_STATUSES = new Set(["retryable", "failed", "timeout", "malformed"]);

/** The units `messages` open, counted as the server counts them. */
export function countUnits(messages: readonly AmspRecord[]): number {
  let units = 0;
  let runOpen = false;
  let steeringOpen = false;
  let compaction = false;
  let taskOpen = false;
  let sawUsage = false;
  let sawReply = false;
  let pendingCompactionUsage = false;
  let turnToolOutputs = false;

  const taskStart = (eligible: boolean): void => {
    if (taskOpen && (sawUsage || sawReply)) runOpen = false;
    if (!runOpen) units += 1;
    taskOpen = true;
    sawUsage = false;
    sawReply = false;
    pendingCompactionUsage = false;
    turnToolOutputs = false;
    runOpen = eligible;
  };

  for (const msg of messages) {
    if ((msg.origin !== undefined && msg.origin.length > 0) || isTaskRecord(msg)) continue;
    const p = msg.payload as Record<string, unknown> & { type?: string; role?: string };
    const userImage = msg.type === "model_msg" && p.type === "image_url";
    if (!userImage) steeringOpen = false;

    if (msg.type === "model_msg") {
      if (compaction) continue;
      if (p.type === "text" && p.role === "user" && typeof p.text === "string") {
        const text = p.text;
        if (text.startsWith("[context_summary]") || text.startsWith("<context_summary>")) continue;
        if (parseUserSteeringText(text) !== null) {
          runOpen = false;
          steeringOpen = true;
          continue;
        }
        const notice = parseBackgroundTaskDoneMessage(text);
        if (notice !== null && (notice.done.delivery === "steering" || turnToolOutputs)) {
          runOpen = false;
          continue;
        }
        const sender = (p as { sender?: string }).sender;
        const eligible =
          (sender !== "harness" || notice !== null) &&
          !parseHandoffMessage(text) &&
          !parseModelSwitchMessage(text);
        taskStart(eligible);
        continue;
      }
      if (p.type === "image_url") {
        if (!steeringOpen) taskStart(true);
        continue;
      }
      if (p.type === "text" && p.role === "assistant" && typeof p.text === "string") {
        if (p.text.trim() !== "") {
          sawReply = true;
          runOpen = false;
        }
        continue;
      }
      if (p.type === "thinking") {
        if (typeof p.thinking === "string" && p.thinking.trim() !== "") runOpen = false;
        continue;
      }
      if (p.type === "tool_call") runOpen = false;
      else if (p.type === "tool_call_output") turnToolOutputs = true;
      continue;
    }

    if (msg.type === "event_msg") {
      if (p.type === "compaction_begin") {
        compaction = true;
        runOpen = false;
      } else if (p.type === "compaction_end") {
        compaction = false;
      } else if (p.type === "abort") {
        runOpen = false;
      } else if (p.type === "request_end") {
        if (compaction) continue;
        if (pendingCompactionUsage) {
          sawUsage = true;
          pendingCompactionUsage = false;
        }
        if (typeof p.status === "string" && HINT_STATUSES.has(p.status)) runOpen = false;
      } else if (p.type === "token_usage") {
        if (compaction) pendingCompactionUsage = true;
        else sawUsage = true;
      } else if (p.type === "request_begin") {
        if (!compaction) turnToolOutputs = false;
      }
    }
  }
  return units;
}
