/**
 * Product tags: free-text labels ("grade 1", "phonics", "pilot") an author gives a product,
 * shared by every ref of it. Pure, so the web can mirror the same rules for instant feedback.
 */
import { HttpError } from "../http/errors.js";

/** The longest one tag may be, in characters. */
export const TAG_MAX = 32;
/** The most tags one product may carry. */
export const TAGS_MAX = 20;

// C0 and C1 control characters; a tag is a label, never layout.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The tags as they are stored: each trimmed with inner whitespace collapsed, empty ones
 * dropped, duplicates (ignoring case) dropped keeping the first spelling, order kept.
 * Anything that is not a list of plain strings is refused with 400 `tags_invalid`, a tag that
 * is too long with `tags_too_long`, and too many tags with `tags_too_many`: one code per
 * problem, so the App words each one itself.
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid("tags must be a list of strings.");
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw invalid("tags must be a list of strings.");
    // Whitespace of any kind (tabs, line breaks) collapses to one space first, so only the
    // control characters that are not whitespace are refused.
    const tag = entry.trim().replace(/\s+/g, " ");
    if (CONTROL.test(tag)) throw invalid("A tag cannot contain control characters.");
    if (!tag) continue;
    if (tag.length > TAG_MAX)
      throw invalid(`A tag can be at most ${TAG_MAX} characters.`, "tags_too_long");
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > TAGS_MAX)
    throw invalid(`A product can have at most ${TAGS_MAX} tags.`, "tags_too_many");
  return tags;
}

function invalid(
  message: string,
  code: "tags_invalid" | "tags_too_long" | "tags_too_many" = "tags_invalid",
): HttpError {
  return new HttpError(400, code, message);
}
