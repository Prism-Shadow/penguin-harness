/**
 * The fallback Session title taken from the Session's own first user line (the listing
 * derives it for the Sessions the DB has no title for) so both fallbacks stay one algorithm.
 *
 * The cut and the sanitizing are core's (`truncateTitle` / `sanitizeTitle`), the same pair the
 * LLM path runs over the model's output: this line is the user's own text, so it keeps
 * anything the model output would have had stripped as prompt residue.
 */
import {
  matchAttachedFileLine,
  matchAttachedImageLine,
  sanitizeTitle,
  stripConversationMarkers,
  truncateTitle,
} from "@prismshadow/penguin-core";

/**
 * Fallback title: take the material's first non-empty line, truncate it to the first few
 * words, and sanitize; if sanitizing empties it out (pure punctuation, etc.) fall back to
 * the truncated line itself; returns null if all-whitespace. Exported for the Trace
 * listing's title fallback (trace-service derives a title from the first user prompt of
 * Sessions the DB has no title for) so both fallbacks stay one algorithm.
 *
 * The cut and the sanitizing are core's (`truncateTitle` / `sanitizeTitle`), the same pair the
 * LLM path runs over the model's output: this line is the user's own text, so it keeps
 * anything the model output would have had stripped as prompt residue.
 */
export function fallbackTitle(text: string): string | null {
  // Strip machine markers first: a skill invocation prepends a `[use_skills]` block, so the
  // raw first non-empty line would otherwise be that marker rather than the user's request.
  const firstLine = stripConversationMarkers(text)
    .split("\n")
    .find((l) => l.trim().length > 0 && !isAttachmentLine(l.trim()));
  if (!firstLine) return null;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  // Drop leading punctuation/quotes before truncating, so a decorated line spends the
  // length budget on words (a line that is nothing but punctuation is kept as-is).
  const lead = collapsed.replace(
    /^["'“”‘’「」『』《》〈〉【】()（）。.．!！?？;；,，、:：\s]+/,
    "",
  );
  const cut = truncateTitle(lead || collapsed);
  // sanitizeTitle strips a pure-punctuation line down to empty — in that case keep the truncated line, guaranteeing "a title is always obtained".
  return sanitizeTitle(cut) ?? cut;
}

/**
 * A line that is nothing but an `[attached image: …]` / `[attached file: …]` marker. A message
 * that carries attachments and no typed text is exactly this line, so a title taken from it
 * would be a truncated absolute path out of the sender's home directory. Such a message gets
 * no fallback at all — the LLM material still carries the path, so the model can name the
 * conversation after the file, and until it answers the UI shows its untitled placeholder.
 */
function isAttachmentLine(line: string): boolean {
  return matchAttachedImageLine(line) !== null || matchAttachedFileLine(line) !== null;
}
