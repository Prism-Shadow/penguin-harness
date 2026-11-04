/**
 * The round navigator's label for one Trace round: the line the user opened it with.
 *
 * The first non-empty line of the starting user text, after the harness's marker blocks
 * (`[use_skills]`, `[handoff_from]`, …) are stripped and attachment marker lines skipped,
 * whitespace collapsed, cut at {@link PROMPT_LABEL_MAX} characters. The view truncates it again
 * to its row; the cap only bounds what the analysis response carries per round.
 *
 * Not the Session title fallback (`fallbackTitle`): that one cuts to a title's length and strips
 * punctuation a title should not lead with, while a navigator row wants the line as typed.
 */
import {
  matchAttachedFileLine,
  matchAttachedImageLine,
  stripConversationMarkers,
} from "@prismshadow/penguin-core";

/** Characters kept, counted by code point so a surrogate pair is never split. */
const PROMPT_LABEL_MAX = 120;

/** The label for a round whose starting user text is `text`; null when no line is left. */
export function promptLabel(text: string): string | null {
  for (const raw of stripConversationMarkers(text).split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (matchAttachedImageLine(line) !== null || matchAttachedFileLine(line) !== null) continue;
    return Array.from(line.replace(/\s+/g, " ")).slice(0, PROMPT_LABEL_MAX).join("");
  }
  return null;
}
