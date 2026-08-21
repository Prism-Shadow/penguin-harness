/**
 * Reconstructs a memory file's pre-conversation text by replaying this conversation's
 * structured tool calls **backwards** over the current content, so the detail view can
 * render one GitHub-style whole-file diff (before → now) instead of stacking per-call
 * snippets. Events arrive chronological (see lib/omni/memory-changes.ts) and are undone
 * newest-first:
 *
 * - an `edit_file` call is undone by replacing its new string back with its old string —
 *   requiring exactly one occurrence (the forward tool required the old string to be
 *   unique, so more than one now means the anchor is ambiguous, none means it's gone);
 *   `replace_all` calls revert every occurrence, accepting the inherent ambiguity that
 *   pre-existing copies of the new string revert too;
 * - a `write_file` call replaced the whole file: nothing earlier can be reconstructed.
 *   When the text reconstructed so far matches the written content, the file is simply
 *   "written this conversation" (rendered as all-new); a mismatch means something outside
 *   the conversation also changed the file, so no whole-file alignment exists.
 *
 * Replay runs over the RAW file content — calls may anchor inside frontmatter — and the
 * caller strips frontmatter from both sides afterwards to diff bodies only.
 */
import type { MemoryChangeEvent } from "./omni/memory-changes";

export type ReplayResult =
  /** Every call reversed cleanly: `before` is the pre-conversation text. */
  | { kind: "diff"; before: string }
  /** A write_file was reached (and the reconstruction matched its content when recorded): the conversation authored the whole current text. */
  | { kind: "rewritten" }
  /** A call couldn't be reversed (anchor missing or ambiguous, material absent, or post-write drift): the file was also changed outside this conversation. */
  | { kind: "unaligned" };

/** Occurrence count of `needle` in `text`, overlapping scans included (any overlap already means ambiguity). */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) count++;
  return count;
}

export function replayBackwards(
  current: string,
  events: readonly MemoryChangeEvent[],
): ReplayResult {
  let text = current;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.op === "write") {
      // The write is this text's origin. A recorded content that no longer matches means
      // later external edits — the all-new rendering would then claim text the
      // conversation never wrote. An unrecorded content can't be checked; trust the record.
      return event.content !== undefined && event.content !== text
        ? { kind: "unaligned" }
        : { kind: "rewritten" };
    }
    const oldString = event.oldString;
    const newString = event.newString;
    // Undoing needs both sides, and a non-empty new string to anchor on (an empty one was
    // a pure deletion — its position is unrecoverable).
    if (oldString === undefined || newString === undefined || newString === "") {
      return { kind: "unaligned" };
    }
    if (event.replaceAll === true) {
      if (!text.includes(newString)) return { kind: "unaligned" };
      text = text.split(newString).join(oldString);
      continue;
    }
    if (countOccurrences(text, newString) !== 1) return { kind: "unaligned" };
    text = text.replace(newString, oldString);
  }
  return { kind: "diff", before: text };
}
