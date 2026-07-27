/**
 * Whole-message stripping of machine-inserted marker blocks: the "human body only" cleaner
 * behind title generation (core) and the hosts' title fallbacks. It lives with the markers —
 * not with its callers — so every tag's producer, parser and stripper stay in one module and
 * cannot drift apart.
 */
import { stripMarkerBlocks } from "./block.js";
import { TITLE_NOISE_TAGS } from "./tags.js";
import { parseGoalMessage } from "./goal-block.js";

/**
 * Strips machine-inserted marker blocks from conversation text so titles are built from the
 * human-meaningful body only — both the material sent to the model and the fallback derived
 * from the raw first message. Engine-synthesized blocks are deliberately not stripped (they
 * are never title material).
 *
 * The [goal] block is taken off first with its own line-anchored parser: it embeds user
 * data, and an objective containing a literal `[/goal]` would make the generic strip below
 * stop early and leak protocol tail text into the title (the anchoring argument lives in
 * goal-block.ts). The generic loop then only ever sees host-composed block content.
 */
export function stripConversationMarkers(text: string): string {
  let out = parseGoalMessage(text)?.rest ?? text;
  for (const tag of TITLE_NOISE_TAGS) out = stripMarkerBlocks(out, tag);
  return out.trim();
}
