/**
 * Whole-message stripping of machine-inserted marker blocks: the "human body only" cleaner
 * behind title generation (core) and the hosts' title fallbacks. It lives with the markers —
 * not with its callers — so every tag's producer, parser and stripper stay in one module and
 * cannot drift apart.
 */
import { stripMarkerBlocks } from "./block.js";
import { TITLE_NOISE_TAGS } from "./tags.js";

/**
 * Strips machine-inserted marker blocks from conversation text so titles are built from the
 * human-meaningful body only — both the material sent to the model and the fallback derived
 * from the raw first message. Engine-synthesized blocks are deliberately not stripped (they
 * are never title material).
 */
export function stripConversationMarkers(text: string): string {
  let out = text;
  for (const tag of TITLE_NOISE_TAGS) out = stripMarkerBlocks(out, tag);
  return out.trim();
}
