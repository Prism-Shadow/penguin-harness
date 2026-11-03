import type { ChatItem } from "@prismshadow/penguin-web/internal";


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
