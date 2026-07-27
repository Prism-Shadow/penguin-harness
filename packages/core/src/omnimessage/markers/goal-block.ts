/**
 * [goal] — the goal-mode round protocol block, prefixed to each round's user message by the
 * Session's goal loop (see goal/goal-prompts.ts for the block's composition).
 *
 * Unlike the other markers, the closing tag is matched **line-anchored** (`\n[/goal]`): the
 * block embeds the current GOAL.yaml verbatim, whose `objective` value is user data — YAML
 * serialization keeps string content off column 0 (block scalars indent, single-line values
 * stay mid-line), so a crafted objective containing `[/goal]` can never terminate the block
 * early. The generic non-anchored matching of block.ts must not be used for this tag.
 *
 * No legacy angle form: the tag postdates the square-marker convention, and the pre-release
 * `<goal_task>` spelling was dropped rather than carried.
 */

/** A goal round's parsed input: the 1-based round number and the body after the block. */
export interface GoalRoundMessage {
  round: number;
  /** The text after the block: the user's original round-1 input, or the re-injected objective. */
  rest: string;
}

/**
 * Recognizes a goal round's input: a message that **starts with** a `[goal]` block whose
 * first line carries `round: N`, the closing tag alone on its own line. Returns the round
 * number and the body after the block (leading blank lines stripped), or null when the
 * message isn't a goal round (rendered as normal user text then).
 */
export function parseGoalMessage(text: string): GoalRoundMessage | null {
  const m = /^\[goal\]\nround: (\d+)\n[\s\S]*?\n\[\/goal\](?:\n|$)/.exec(text);
  if (!m) return null;
  const round = Number(m[1]);
  if (!Number.isInteger(round) || round <= 0) return null;
  return { round, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}
