/**
 * How a recalled queued message (#287) merges back into the composer's draft.
 *
 * Pulled out of ChatInput for the same reason as `midRunAction`: the restore makes two small
 * decisions whose reasons are invisible at the call site, and inline they are easy to break
 * one at a time.
 *
 * - The recalled text goes in FRONT of whatever is currently typed — it was composed first —
 *   and a newline joins the two only when both sides actually carry text (a whitespace-only
 *   draft counts as empty, so the restore never leaves a stray blank line behind it).
 * - A staged goal chip is released when the recall brings file attachments back. A goal
 *   draft cannot carry files: engaging the chip clears them and the server refuses them
 *   (see ChatInput's toggleGoal), so keeping the chip would park the restored files behind
 *   a Send that can never enable — and by the time the composer sees them, their scratchpad
 *   copies are already deleted server-side, making the chips the only copy left. Images
 *   never release the chip: a goal carries them (folded into the objective as path lines).
 */
export interface RecalledDraftMerge {
  /** The new draft body: recalled text in front, the current draft behind. */
  text: string;
  /** Release the staged goal chip (the recall restored file attachments, which a goal draft cannot carry). */
  dropGoal: boolean;
}

export function mergeRecalledDraft(args: {
  /** The withdrawn message's text, as the server handed it back. */
  recalledText: string;
  /** What is currently typed (the composer's live value, not a stale render's). */
  currentText: string;
  /** Number of file attachments the recall brought back. */
  recalledFiles: number;
  /** Whether the goal chip is currently staged. */
  goalOn: boolean;
}): RecalledDraftMerge {
  const current = args.currentText;
  const text = current.trim()
    ? args.recalledText
      ? `${args.recalledText}\n${current}`
      : current
    : args.recalledText;
  return { text, dropGoal: args.goalOn && args.recalledFiles > 0 };
}
