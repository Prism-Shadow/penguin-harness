/**
 * Parses attachment lines out of user message text (for rendering in the chat UI).
 *
 * Two producers append these lines to a user message, both because the bytes cannot
 * travel in the conversation itself (see core's markers/attachment-lines.ts, which owns
 * the line format both sides share):
 *   - "[attached image: <path|URL>]" — core, when the session's model doesn't support
 *     images: the input images are written to the session scratchpad and read by path;
 *   - "[attached file: <path>]" — the server, for the composer's file attachments, which
 *     land in the same scratchpad directory.
 *
 * At render time these lines are extracted from the body text: images are turned back
 * into pictures (http(s) URLs are referenced directly; local scratchpad paths are mapped
 * to the `/api/sessions/<sessionId>/scratchpad/<fileName>` endpoint), files become a
 * banner listing their names. Unrecognized lines are left displayed as-is in the text
 * (e.g. a "could not be saved" note, or an image path outside this system).
 */
import {
  ATTACHED_FILE_PREFIX,
  ATTACHED_IMAGE_PREFIX,
  matchAttachedFileLine,
  matchAttachedImageLine,
} from "@prismshadow/penguin-core/markers";

export interface ParsedAttachments {
  /** Body text with restored attachment lines removed (unrecognized lines are kept). */
  text: string;
  /** Restored image URLs (in order of appearance; usable directly as img src). */
  images: string[];
  /** Absolute paths of attached files (in order of appearance; on the server's filesystem, not fetchable as-is). */
  files: string[];
}

/** Local scratchpad path → session file endpoint (Windows separators supported). */
const SCRATCHPAD_PATH = /[/\\]scratchpad[/\\]([^/\\]+)[/\\]([A-Za-z0-9._-]+)$/;

/** Resolves a single image line's address; returns null if unrecognized (the line is kept in the text). */
function resolveAttachment(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  const m = SCRATCHPAD_PATH.exec(value);
  if (m)
    return `/api/sessions/${encodeURIComponent(m[1]!)}/scratchpad/${encodeURIComponent(m[2]!)}`;
  return null;
}

/**
 * Splits attachment lines out of user text into "body text + image addresses + file paths";
 * returns the input unchanged if there are no attachment lines at all (the trailing-blank-line
 * cleanup below must not touch an ordinary message).
 */
export function splitAttachments(text: string): ParsedAttachments {
  if (!text.includes(ATTACHED_IMAGE_PREFIX) && !text.includes(ATTACHED_FILE_PREFIX)) {
    return { text, images: [], files: [] };
  }
  const kept: string[] = [];
  const images: string[] = [];
  const files: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const imageTarget = matchAttachedImageLine(trimmed);
    const src = imageTarget !== null ? resolveAttachment(imageTarget) : null;
    if (src) {
      images.push(src);
      continue;
    }
    // A file line always resolves: unlike an image it isn't rendered from its address, the
    // banner only names it — so any path the producer wrote is shown as an attachment.
    const filePath = matchAttachedFileLine(trimmed);
    if (filePath !== null) {
      files.push(filePath);
      continue;
    }
    kept.push(line);
  }
  // Attachment lines are appended as a block at the end; clean up extra trailing blank lines after removal.
  return { text: kept.join("\n").replace(/\n+$/, ""), images, files };
}

/** Display name of an attached file: the last path segment (both separators, since the path comes from the server's filesystem). */
export function attachmentFileName(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  return segments[segments.length - 1] || filePath;
}
