/**
 * `[attached image: …]` / `[attached file: …]` — the one-line markers that hand a file on
 * disk to the model.
 *
 * Unlike this module's other markers these are not `[tag]…[/tag]` blocks and they are
 * **appended after** the user's own text rather than prefixed to it. That placement is
 * load-bearing: the origin blocks and `[use_skills]` are all parsed at index 0 of the
 * message, so a second leading block would break that chain — an attachment is a trailing
 * footnote to the message, not a new frame around it.
 *
 * Two producers write them, for the same reason (the bytes cannot travel in the message
 * itself, so the message carries their path instead):
 *   - `[attached image: <path|URL>]` — core, when the session model has no image input: the
 *     input images are written to the session scratchpad and the model reads them by path via
 *     describe_image (see internal/session-support.ts);
 *   - `[attached file: <path>]` — the server, for the composer's file attachments: the upload
 *     lands in the session scratchpad and the model opens it with its ordinary file tools
 *     (see services/task-attachments.ts).
 *
 * One consumer reads them: the Web App's message renderer, which pulls the lines back out of
 * the body text and shows an image / an attachment banner instead (see lib/attachments.ts).
 * Producer and parser share the spellings below so the two can never drift apart.
 */

/** Line prefix of an image attachment; exported so a parser can cheaply pre-test a whole body text. */
export const ATTACHED_IMAGE_PREFIX = "[attached image: ";
/** Line prefix of a file attachment (same purpose as ATTACHED_IMAGE_PREFIX). */
export const ATTACHED_FILE_PREFIX = "[attached file: ";

/** The line naming one input image by absolute path (image-less model) or by http(s) URL (referenced as-is). */
export function attachedImageLine(target: string): string {
  return `${ATTACHED_IMAGE_PREFIX}${target}]`;
}

/** The line naming one uploaded file by absolute path. */
export function attachedFileLine(filePath: string): string {
  return `${ATTACHED_FILE_PREFIX}${filePath}]`;
}

const ATTACHED_IMAGE_RE = /^\[attached image: (.+)\]$/;
const ATTACHED_FILE_RE = /^\[attached file: (.+)\]$/;

/** Inverse of `attachedImageLine`: the target of a whole line that is one image attachment, else null. */
export function matchAttachedImageLine(line: string): string | null {
  return ATTACHED_IMAGE_RE.exec(line)?.[1] ?? null;
}

/** Inverse of `attachedFileLine`: the path of a whole line that is one file attachment, else null. */
export function matchAttachedFileLine(line: string): string | null {
  return ATTACHED_FILE_RE.exec(line)?.[1] ?? null;
}
