/**
 * Composer input history (shell-style ↑/↓ recall): pure logic, unit-testable.
 *
 * History list: the session's previous composer inputs, oldest → newest, derived from the
 * stream items. Only text the user actually typed into the composer qualifies — regular
 * prompts (protocol blocks and attachment lines stripped) and mid-run steering messages.
 * Machine-injected texts are excluded: handoff / model-switch source blocks carry no user
 * prose, scheduled-trigger prompts were authored in the schedule config rather than typed
 * here, and goal rounds past 1 are the loop re-sending an objective already in the list.
 * Consecutive duplicates collapse (recalling the same text twice in a row is one entry),
 * matching shell behavior.
 *
 * Navigation: a small state machine the composer drives from ArrowUp/ArrowDown.
 * - Stepping back only starts from an effectively empty draft (a non-empty draft means the
 *   user is writing, and hijacking ↑ there would break in-text caret movement); whatever
 *   was in the box is stashed and restored when stepping forward past the newest entry.
 * - While navigating, any edit ends the session implicitly: the composer compares the
 *   current text against `recalled` and both steppers bail on a mismatch, handing ↑/↓ back
 *   to the caret. The oldest entry pins (repeated ↑ stays put, like a shell at the top of
 *   its history).
 * - The caret-line guards mirror multi-line shell behavior: within a recalled multi-line
 *   entry, ↑/↓ first walk the caret through the lines; only ↑ on the first line / ↓ on the
 *   last line step the history.
 */
import type { ChatItem } from "../../lib/omni/stream-model";
import { splitAttachments } from "../../lib/attachments";
import { parseUserMessageBody } from "./user-message-body";

/** Active navigation state; null in the composer means "not navigating". */
export interface HistoryNav {
  /** Index into the history list of the entry currently recalled into the composer. */
  index: number;
  /** The draft text as it was when navigation began; restored when stepping past the newest entry. */
  stash: string;
  /** The text the last step wrote into the composer; a mismatch with the live text means the user edited, which ends navigation. */
  recalled: string;
}

/** A step's outcome: the new navigation state (null = navigation ended) and the text to put in the composer. */
export interface HistoryStep {
  nav: HistoryNav | null;
  text: string;
}

/** Derives the recallable history (oldest → newest) from the stream items. */
export function buildInputHistory(items: readonly ChatItem[]): string[] {
  const out: string[] = [];
  const push = (text: string) => {
    if (text !== "" && out[out.length - 1] !== text) out.push(text);
  };
  for (const item of items) {
    if (item.kind === "user_text") {
      // Harness-injected inputs (goal rounds, hook continues) were never typed here —
      // recalling one into the composer would resend a machine message as user input.
      if (item.sender === "harness") continue;
      const parsed = parseUserMessageBody(item.text);
      // Background completion notices and App Center requests are machine-written, never typed here either.
      if (!parsed || parsed.scheduled || parsed.appCenter || parsed.backgroundDone) continue;
      push(parsed.body);
    } else if (item.kind === "user_steering") {
      push(splitAttachments(item.text).text.trim());
    }
  }
  return out;
}

/** ↑: step to an older entry. Returns null when the key should keep its native meaning. */
export function historyStepBack(
  history: readonly string[],
  nav: HistoryNav | null,
  current: string,
): HistoryStep | null {
  if (history.length === 0) return null;
  if (nav === null) {
    // Only an (effectively) empty draft starts navigation; the stash keeps it verbatim.
    if (current.trim() !== "") return null;
    const index = history.length - 1;
    const text = history[index]!;
    return { nav: { index, stash: current, recalled: text }, text };
  }
  if (current !== nav.recalled) return null; // edited: navigation is over
  if (nav.index === 0) return { nav, text: nav.recalled }; // pinned at the oldest entry
  const index = nav.index - 1;
  const text = history[index]!;
  return { nav: { ...nav, index, recalled: text }, text };
}

/** ↓: step to a newer entry; past the newest restores the stashed draft and ends navigation. */
export function historyStepForward(
  history: readonly string[],
  nav: HistoryNav | null,
  current: string,
): HistoryStep | null {
  if (nav === null || current !== nav.recalled) return null;
  if (nav.index >= history.length - 1) return { nav: null, text: nav.stash };
  const index = nav.index + 1;
  const text = history[index]!;
  return { nav: { ...nav, index, recalled: text }, text };
}

/** True when no newline separates the caret from the start of the text (the caret sits on line 1). */
export function caretOnFirstLine(text: string, caret: number): boolean {
  return !text.slice(0, caret).includes("\n");
}

/** True when no newline separates the caret from the end of the text (the caret sits on the last line). */
export function caretOnLastLine(text: string, caret: number): boolean {
  return !text.slice(caret).includes("\n");
}
