/**
 * Composer file attachments — the `{type:"file"}` variant of TaskInputPart.
 *
 * The browser has no Session while a chat is still a draft, so there is no upload endpoint to
 * call before sending: the file rides the task request itself as a base64 `data:` URL, exactly
 * like a pasted image does. On the way in it is written to the **Session scratchpad**
 * (`<agent>/scratchpad/<sessionId>/`, deleted with the Session, so cleanup is free) and the
 * message text gains one `[attached file: <absolute path>]` line per file — the bytes never
 * enter the conversation, the model opens the file by path with its ordinary file tools.
 *
 * The line format and its placement are not defined here: they are shared with core's
 * `[attached image: …]` producer and the Web renderer that parses both
 * (`@prismshadow/penguin-core/markers` → attachment-lines.ts, plus `appendAttachmentLines`),
 * so the two conventions cannot drift apart.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { appendAttachmentLines, attachedFileLine } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";

/**
 * Per-file cap. Deliberately below the workspace upload's 14MB: several attachments can ride
 * one task request, and the whole body still has to fit the global 20MB limit (base64 inflates
 * by 4/3), so a smaller per-file ceiling keeps "one big file" working while leaving room for
 * "a handful of ordinary ones". Oversize is a 413, matching the workspace upload route.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Longest sanitized stem kept on disk: enough to stay recognizable, short enough to keep paths sane. */
const MAX_STEM_LEN = 80;

/** The 6-hex space makes a second collision negligible; the cap only guards against a filesystem stuck on EEXIST. */
const MAX_NAME_ATTEMPTS = 16;

/** One validated attachment, bytes already decoded (they are held in memory only until the write below). */
export interface TaskAttachment {
  /** Original file name as submitted (validated: non-empty, no path separators, no `..`). */
  fileName: string;
  bytes: Buffer;
}

/**
 * Validate one `{type:"file"}` input part. Shape problems are 400s in the same style as the
 * neighbouring text/image checks; only the size cap answers 413 (`file_too_large`, the code
 * the Web App already has copy for). `index` is the part's position in `input`, so the message
 * points at the offending item like the other input errors do.
 */
export function parseAttachmentPart(part: Record<string, unknown>, index: number): TaskAttachment {
  const fileName = part.fileName;
  // Path separators and `..` are rejected rather than sanitized away: the name is the user's,
  // and a name that looks like a path means the caller is confused about the contract (the
  // write below composes the path itself, and sanitization happens there).
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    fileName.includes("\0")
  ) {
    throw badRequest(
      `input[${index}].fileName must be a non-empty file name without path separators or "..".`,
    );
  }
  const dataUrl = part.dataUrl;
  // `[^,]*` for the media type, not `[^;,]*`: a browser may hand out parameters
  // (`data:text/plain;charset=utf-8;base64,…`), and only the `;base64,` marker separates the
  // type from the payload. The payload's character class is the actual check that it IS
  // base64 (whitespace tolerated — line-wrapped encoders decode fine).
  const match =
    typeof dataUrl === "string" ? /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl) : null;
  if (!match) {
    throw badRequest(`input[${index}].dataUrl must be a base64 data: URL of the file's bytes.`);
  }
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length === 0) {
    throw badRequest(`input[${index}].dataUrl decodes to an empty file.`);
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(
      413,
      "file_too_large",
      `Attached file exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.`,
    );
  }
  return { fileName, bytes };
}

/**
 * Map a submitted name onto a name that is safe on disk **and** readable back out: everything
 * outside `[A-Za-z0-9._-]` becomes `-` (the same character set the scratchpad read endpoint
 * serves, so an attachment stays fetchable), the extension is preserved, and a stem that
 * sanitizes away entirely (e.g. an all-CJK name) falls back to `file` rather than producing a
 * bare extension.
 */
function scratchpadName(fileName: string): string {
  const ext = path.extname(fileName);
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-");
  const stem = clean(fileName.slice(0, fileName.length - ext.length)).slice(0, MAX_STEM_LEN);
  return `${stem.replace(/^-+$/, "") || "file"}${clean(ext)}`;
}

/**
 * Write one attachment into `dir` and return its absolute path. The plain sanitized name is
 * tried first (the model — and the user reading the message — sees `report.pdf`, not an opaque
 * id); "wx" makes the create exclusive, so a second upload of the same name lands next to the
 * first as `report-3f9a1c.pdf` instead of overwriting it (same convention as core's image
 * uploads).
 */
async function writeAttachment(dir: string, attachment: TaskAttachment): Promise<string> {
  const base = scratchpadName(attachment.fileName);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 0 ? base : `${stem}-${randomBytes(3).toString("hex")}${ext}`;
    const file = path.join(dir, name);
    try {
      await fs.writeFile(file, attachment.bytes, { flag: "wx" });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(
    `failed to allocate a unique attachment file name under ${dir} after ${MAX_NAME_ATTEMPTS} attempts`,
  );
}

/**
 * Land every attachment in the Session scratchpad `dir` and return the Prompt with one
 * `[attached file: <path>]` line appended per file. Placement follows core's shared rule
 * (after the last user text message; attachments-only input becomes a line-only text
 * message), so a Prompt carrying both images and files still ends in a single trailing block.
 * Returns `messages` untouched when there is nothing to attach — no directory is created.
 */
export async function attachFilesToInput(
  messages: OmniMessage[],
  attachments: TaskAttachment[],
  dir: string,
): Promise<OmniMessage[]> {
  if (attachments.length === 0) return messages;
  await fs.mkdir(dir, { recursive: true });
  const lines: string[] = [];
  // Sequential on purpose: the exclusive-create retry above resolves collisions against files
  // that already exist, and writing the batch one at a time keeps two same-named uploads in
  // the same message from racing each other for the plain name.
  for (const attachment of attachments) {
    lines.push(attachedFileLine(await writeAttachment(dir, attachment)));
  }
  return appendAttachmentLines(messages, lines);
}
