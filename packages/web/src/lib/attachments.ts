/**
 * Parses image attachment lines out of user message text (for rendering in
 * the chat UI).
 *
 * Core folds an input image into an "[attached image: <path|URL>]" line
 * appended to the user text — always for a goal objective, and for a prompt
 * or a steering message when the session's model has no vision. The line's
 * spelling comes from core (`attachedImageLine` / `parseAttachedImageLine`,
 * in omnimessage/markers) so that the writer and this reader cannot drift.
 *
 * What is local to the Web is the address mapping below: http(s) URLs are
 * referenced directly; local scratchpad paths are mapped to the
 * `/api/sessions/<sessionId>/scratchpad/<fileName>` endpoint; unrecognized
 * lines are left displayed as-is in the text (e.g. a "could not be saved"
 * note, or a path outside this system).
 */
import {
  hasAttachedImageLine,
  parseAttachedImageLine,
} from "@prismshadow/penguin-core/omnimessage";

export interface ParsedAttachments {
  /** Body text with restored attachment lines removed (unrecognized lines are kept). */
  text: string;
  /** Restored image URLs (in order of appearance; usable directly as img src). */
  images: string[];
}

/** Local scratchpad path → session file endpoint (Windows separators supported). */
const SCRATCHPAD_PATH = /[/\\]scratchpad[/\\]([^/\\]+)[/\\]([A-Za-z0-9._-]+)$/;

/** Resolves a single attachment line's address; returns null if unrecognized (the line is kept in the text). */
function resolveAttachment(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  const m = SCRATCHPAD_PATH.exec(value);
  if (m)
    return `/api/sessions/${encodeURIComponent(m[1]!)}/scratchpad/${encodeURIComponent(m[2]!)}`;
  return null;
}

/** Splits attachment lines out of user text into "body text + list of image addresses"; returns the input unchanged if there are no attachment lines. */
export function splitImageAttachments(text: string): ParsedAttachments {
  if (!hasAttachedImageLine(text)) return { text, images: [] };
  const kept: string[] = [];
  const images: string[] = [];
  for (const line of text.split("\n")) {
    const address = parseAttachedImageLine(line);
    const src = address ? resolveAttachment(address) : null;
    if (src) images.push(src);
    else kept.push(line);
  }
  // Attachment lines are appended as a block at the end; clean up extra trailing blank lines after removal.
  return { text: kept.join("\n").replace(/\n+$/, ""), images };
}
