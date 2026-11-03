/**
 * Which assistant reply's rich blocks take input.
 *
 * A reply can end with a choice or a form (```a2ui blocks the UI package draws), and picking an
 * answer fills the composer. Only the conversation's live question may do that: the latest reply,
 * and only while nothing has been said to the model since. A question further up was answered,
 * or overtaken, by what followed it, so its blocks stay on screen read-only, as they do in a
 * subagent's conversation and in the Trace view.
 *
 * Kept free of React so the rule is testable on its own (test/a2ui-reply.test.ts); the
 * transcript applies it in MessageItems.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

/**
 * Input to the model after a reply: anything the person sent (a prompt, an image, a steer
 * mid-run) and anything the harness fed in their place (a goal round, a background
 * completion). Either way the model is about to answer something else, so the reply above is
 * no longer the open question.
 */
function isInput(item: ChatItem): boolean {
  return (
    item.kind === "user_text" ||
    item.kind === "user_image" ||
    item.kind === "user_steering" ||
    item.kind === "background_notice"
  );
}

/**
 * Index of the reply whose blocks take input, or -1 when none does. `origin` is the render
 * level's origin chain: a pick fills the main conversation's composer, so only the main
 * conversation (an empty chain) takes input, and a subagent's conversation in the panel stays
 * read-only. Scans back from the end, so the cost per render is the run of items after the
 * last reply (stats, tool calls), not the transcript.
 */
export function interactiveReplyIndex(
  items: readonly ChatItem[],
  origin: readonly string[],
): number {
  if (origin.length > 0) return -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "assistant_text") return i;
    if (isInput(item)) return -1;
  }
  return -1;
}
