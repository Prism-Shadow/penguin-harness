/**
 * How a clicked draft-screen example lands in the composer.
 *
 * The click FILLS the composer and sends nothing — the user reads what arrived and presses
 * Send. Two decisions whose reasons are invisible at the call site live here beside them
 * (same split as recall-draft.ts):
 *
 * - **The example takes the whole text body.** Whatever was typed is cleared first, so the
 *   box holds the prompt and nothing else. Appending behind a draft was tried and reverted:
 *   it left the user to find and delete the leftover half themselves, and browsing the list
 *   stacked one canned prompt behind another. A click asks for *this* prompt, so that is
 *   what the box gets, and the caret parks at the top of it — a long prompt scrolled to its
 *   last line reads as broken.
 * - **The example's skills join the selection instead of replacing it**, and only those the
 *   selected Agent actually has installed. The composer wraps the selection into a
 *   `[use_skills]` block at send time, so pressing Send produces exactly the message this card
 *   used to submit by itself; an uninstalled name would pin a Skill that isn't there, and
 *   dropping the existing selection would throw away a pick the user had already made. The
 *   selection is additive where the text is not, because it cannot tell an earlier example's
 *   pin from the user's own choice — text has no such ambiguity.
 *
 * The prompt itself goes in verbatim. Building the `[use_skills]` block here instead would put
 * a marker block in the textarea, which is not something a user can sensibly edit — and the
 * send path would wrap it a second time.
 */
export interface ExampleFill {
  /** The composer's new body text: the example's prompt, alone. */
  text: string;
  /** The new skill selection: what was already selected, plus the example's installed skills. */
  skills: string[];
}

export function buildExampleFill(args: {
  /** The example's prompt, read from the active dictionary. */
  prompt: string;
  /** Skill names the example pins. */
  exampleSkills: readonly string[];
  /** Skill names installed on the selected Agent. */
  installedSkills: readonly string[];
  /** Skill names currently selected in the composer. */
  selectedSkills: readonly string[];
}): ExampleFill {
  const added = args.exampleSkills.filter(
    (name) => args.installedSkills.includes(name) && !args.selectedSkills.includes(name),
  );
  return { text: args.prompt, skills: [...args.selectedSkills, ...added] };
}
