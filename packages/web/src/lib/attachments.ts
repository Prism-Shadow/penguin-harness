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
 * banner listing their names. Both kinds are recognized only when the address is one this
 * system produced — a scratchpad path (or, for an image, an http(s) URL). Anything else is
 * left displayed as-is in the text (e.g. a "could not be saved" note, a path outside this
 * system, or a marker-shaped line a user simply typed).
 */
import { apiUrl } from "./server-context";
import { machineForSession } from "./session-machines";

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

/**
 * Local scratchpad path → session file endpoint (Windows separators supported). The file name
 * is anything but a separator: an attachment keeps the name the user gave it (`报告.pdf`), and
 * both segments are percent-encoded into the URL below, so restricting the character set here
 * would only make non-ASCII uploads unreachable.
 */
const SCRATCHPAD_PATH = /[/\\]scratchpad[/\\]([^/\\]+)[/\\]([^/\\]+)$/;

/**
 * Resolves a single image line's address; returns null if unrecognized (the line is kept in
 * the text). A scratchpad address names its own Session, so it carries the routing rule with
 * it: an attachment on a Session that lives on a machine has to be fetched from THERE, and
 * this is a URL rather than a call, so nothing else would apply the rule for it.
 */
function resolveAttachment(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  const m = SCRATCHPAD_PATH.exec(value);
  if (m) {
    const sessionId = m[1]!;
    return apiUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/scratchpad/${encodeURIComponent(m[2]!)}`,
      machineForSession(sessionId),
    );
  }
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
    // Gated on the scratchpad shape exactly like an image is, and for the same reason: nothing
    // stops a person from typing `[attached file: …]` into the composer, and the marker is only
    // trustworthy where the server wrote it. An ungated file line would let one project member
    // render arbitrary text inside another member's system-notice chrome — and would read to
    // the model as a genuine invitation to open whatever path it names.
    const filePath = matchAttachedFileLine(trimmed);
    if (filePath !== null && SCRATCHPAD_PATH.test(filePath)) {
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
