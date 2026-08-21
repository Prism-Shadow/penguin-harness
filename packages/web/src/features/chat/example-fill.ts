/**
 * How a clicked draft-screen example lands in the composer.
 *
 * The click FILLS the composer and sends nothing — the user reads what arrived and presses
 * Send. That leaves two decisions whose reasons are invisible at the call site, so they live
 * here beside them (same split as recall-draft.ts):
 *
 * - **Typed text is never overwritten.** The prompt is appended behind whatever is already in
 *   the box, one blank line between the two, so the draft reads in the order it was composed;
 *   a whitespace-only draft counts as empty and the prompt simply takes the box. `insertAt`
 *   marks where the prompt starts, so the caller can park the caret and the scroll there — a
 *   long prompt landing on its last line reads as broken.
 * - **The example's skills join the selection instead of replacing it**, and only those the
 *   selected Agent actually has installed. The composer wraps the selection into a
 *   `[use_skills]` block at send time, so pressing Send produces exactly the message this card
 *   used to submit by itself; an uninstalled name would pin a Skill that isn't there, and
 *   dropping the existing selection would throw away a pick the user had already made.
 *
 * The prompt itself goes in verbatim. Building the `[use_skills]` block here instead would put
 * a marker block in the textarea, which is not something a user can sensibly edit — and the
 * send path would wrap it a second time.
 */
export interface ExampleFill {
  /** The composer's new body text: the current draft (if any), then the example's prompt. */
  text: string;
  /** Offset in `text` where the prompt starts — 0 when it took an empty box. */
  insertAt: number;
  /** The new skill selection: what was already selected, plus the example's installed skills. */
  skills: string[];
}

export function buildExampleFill(args: {
  /** The example's prompt, read from the active dictionary. */
  prompt: string;
  /** What is in the composer right now (its live value, not a stale render's). */
  currentText: string;
  /** Skill names the example pins. */
  exampleSkills: readonly string[];
  /** Skill names installed on the selected Agent. */
  installedSkills: readonly string[];
  /** Skill names currently selected in the composer. */
  selectedSkills: readonly string[];
}): ExampleFill {
  // trimEnd, not trim: leading whitespace is the user's, trailing whitespace would only stack
  // up in front of the blank line — and a draft that is nothing but whitespace becomes "".
  const kept = args.currentText.trimEnd();
  const prefix = kept ? `${kept}\n\n` : "";
  const added = args.exampleSkills.filter(
    (name) => args.installedSkills.includes(name) && !args.selectedSkills.includes(name),
  );
  return {
    text: `${prefix}${args.prompt}`,
    insertAt: prefix.length,
    skills: [...args.selectedSkills, ...added],
  };
}
