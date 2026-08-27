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
import {
  appendAttachmentLines,
  attachedFileLine,
  modelVisiblePath,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { MAX_ATTACHMENT_COUNT } from "./attachment-limits.js";

/**
 * A file's SIZE is bounded here by nothing: what one attachment may weigh is the body cap's
 * business (app.ts), and nothing downstream of this module scales with it — the bytes go to disk
 * and come back through the model's own bounded file tools.
 *
 * The per-message file COUNT is enforced here rather than delegated to that body cap, because
 * the two bound different things: a body well inside the cap still fits ~350k minimal `file`
 * parts, which is 350k sequential writes into one directory and 350k marker lines on one
 * message. See MAX_ATTACHMENT_COUNT in attachment-limits.ts.
 */

/**
 * Longest stem kept on disk, measured in **UTF-8 bytes**: filesystems cap a name near 255
 * bytes, and a CJK character costs three of them — a character count would let a Chinese name
 * blow the real limit while an English one stayed far under it.
 */
const MAX_STEM_BYTES = 80;

/** Windows reserves these device names with or without an extension (`con`, `con.txt`), case-insensitively. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Format and control characters (Unicode category C) — invisible, and the vector behind right-to-left file-name spoofing. */
const INVISIBLE_CHAR = /\p{C}/u;

/**
 * True when a character must not reach a file name. ASCII keeps the long-standing whitelist:
 * a space or a shell metacharacter inside a path the model is about to paste into a command is
 * a footgun, so anything outside `[A-Za-z0-9._-]` still becomes `-` down there. Above ASCII the
 * rule inverts — the character is kept as typed, so `报告.pdf` reaches the model as `报告.pdf`
 * instead of collapsing to an anonymous `file.pdf` (CJK, accents and emoji are all harmless to
 * a shell). The exception is Unicode category C: invisible controls, and the bidi overrides
 * that let a name render as something it is not.
 */
function unsafeNameChar(ch: string): boolean {
  if (/[A-Za-z0-9._-]/.test(ch)) return false;
  return ch.codePointAt(0)! < 0x80 || INVISIBLE_CHAR.test(ch);
}

/** Replace every unsafe character with `-`, iterating code points so a surrogate pair survives intact. */
function sanitizeSegment(value: string): string {
  return Array.from(value, (ch) => (unsafeNameChar(ch) ? "-" : ch)).join("");
}

/** Truncate to a UTF-8 byte budget on character boundaries (iterating a string yields whole code points, so a surrogate pair is never split). */
function truncateBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let out = "";
  for (const ch of value) {
    if (Buffer.byteLength(out) + Buffer.byteLength(ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

/** The 6-hex space makes a second collision negligible; the cap only guards against a filesystem stuck on EEXIST. */
const MAX_NAME_ATTEMPTS = 16;

/** One validated attachment, bytes already decoded (they are held in memory only until the write below). */
export interface TaskAttachment {
  /** Original file name as submitted (validated: non-empty, no path separators, no `..`). */
  fileName: string;
  bytes: Buffer;
  /**
   * Media type from the submitted data URL (parameters included, e.g. `text/plain;charset=utf-8`);
   * empty when the URL carried none. Kept so a queued message's recall can re-encode the
   * on-disk bytes into the same data URL shape the composer submitted (see readRecalledFiles).
   */
  mime: string;
}

/**
 * Validate one `{type:"file"}` input part. Every problem here is a shape problem and answers
 * 400, in the same style as the neighbouring text/image checks — a file's size is the body
 * cap's business (app.ts), not this function's. `index` is the part's position in the request
 * array named by `field` (default `input`; the steer route passes `files`), so the message
 * points at the offending item like the other input errors do.
 */
export function parseAttachmentPart(
  part: Record<string, unknown>,
  index: number,
  field = "input",
): TaskAttachment {
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
      `${field}[${index}].fileName must be a non-empty file name without path separators or "..".`,
    );
  }
  const dataUrl = part.dataUrl;
  // `[^,]*` for the media type, not `[^;,]*`: a browser may hand out parameters
  // (`data:text/plain;charset=utf-8;base64,…`), and only the `;base64,` marker separates the
  // type from the payload. The payload's character class is the actual check that it IS
  // base64 (whitespace tolerated — line-wrapped encoders decode fine).
  const match =
    typeof dataUrl === "string" ? /^data:([^,]*);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl) : null;
  if (!match) {
    throw badRequest(`${field}[${index}].dataUrl must be a base64 data: URL of the file's bytes.`);
  }
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length === 0) {
    throw badRequest(`${field}[${index}].dataUrl decodes to an empty file.`);
  }
  return { fileName, bytes, mime: match[1]! };
}

/**
 * A queued message's file attachment as held for recall: the scratchpad path it was written
 * to, plus what is needed to rebuild the composer-shaped part — the submitted name and media
 * type (the bytes stay on disk; queued entries never hold file payloads in memory).
 */
export interface RecallableFile {
  fileName: string;
  path: string;
  mime: string;
}

/**
 * Read recalled attachments back from the scratchpad into the `{fileName, dataUrl}` shape the
 * composer submits. Best effort: a file that disappeared meanwhile (Session deleted from
 * another tab, manual cleanup) is omitted rather than failing the whole recall — the text and
 * images still come back. The caller deletes the on-disk copies afterwards (removeAttachments);
 * reading first keeps the two steps safely ordered.
 */
export async function readRecalledFiles(
  files: RecallableFile[],
): Promise<{ fileName: string; dataUrl: string }[]> {
  const read = await Promise.all(
    files.map(async (f) => {
      try {
        const bytes = await fs.readFile(f.path);
        const mime = f.mime || "application/octet-stream";
        return { fileName: f.fileName, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
      } catch {
        return null;
      }
    }),
  );
  return read.filter((f) => f !== null);
}

/**
 * Enforce the per-request file count against everything accepted so far. Called after **each**
 * `file` part rather than once at the end, so an `input` naming a hundred files stops at the
 * part that crosses the line instead of base64-decoding the whole array first.
 */
export function assertAttachmentBudget(attachments: TaskAttachment[]): void {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new HttpError(
      413,
      "too_many_files",
      `A message may carry at most ${MAX_ATTACHMENT_COUNT} attached files.`,
    );
  }
}

/**
 * Map a submitted name onto a name that is safe on disk **and** still recognizably the user's
 * own: `报告 2026.pdf` becomes `报告-2026.pdf` (see unsafeNameChar — the words survive, only the
 * shell-hostile ASCII is replaced), so the model reads a meaningful path and a person looking
 * at the message recognizes what they attached.
 *
 * The rest is Windows-shaped hygiene: trailing dots and spaces are dropped (Windows silently
 * strips them, so `a.` and `a` would be the same file), a reserved device name is prefixed
 * (`con.txt` → `_con.txt`), the stem is capped by UTF-8 bytes, and a stem that sanitizes away
 * entirely falls back to `file` rather than producing a bare extension.
 */
function scratchpadName(fileName: string): string {
  const ext = sanitizeSegment(path.extname(fileName));
  const rawStem = fileName.slice(0, fileName.length - path.extname(fileName).length);
  // Trim after truncating: a cut can expose a trailing dot or space that was mid-name before.
  const stem = truncateBytes(sanitizeSegment(rawStem), MAX_STEM_BYTES).replace(/[. ]+$/, "");
  // Nothing but replacement dashes carries no more information than an empty stem did.
  if (!stem || /^-+$/.test(stem)) return `file${ext}`;
  return WINDOWS_RESERVED.test(stem) ? `_${stem}${ext}` : `${stem}${ext}`;
}

/**
 * Write one attachment into `dir` and return its absolute path. The plain sanitized name is
 * tried first (the model — and the user reading the message — sees `report.pdf`, not an opaque
 * id); "wx" makes the create exclusive, so a second upload of the same name lands next to the
 * first as `report-3f9a1c.pdf` instead of overwriting it (same convention as core's image
 * uploads).
 *
 * "wx" is O_CREAT|O_EXCL, which also refuses to follow a symlink at the final component: a link
 * planted at `report.pdf` fails with EEXIST and the retry allocates a suffixed name instead of
 * writing through it. The containment check for the *directory* is separate — see openScratchpadDir.
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
 * Create (or reuse) this Session's scratchpad directory and hand back the path to write into.
 *
 * `fs.mkdir(…, {recursive:true})` succeeds silently when the directory is already a **symlink**
 * to somewhere else, and nothing downstream would notice — so the result is realpath'd and
 * required to still sit inside the Agent's scratchpad root, the same containment rule the
 * Workspace upload path applies (workspace-files-service.resolveWriteParent). Only the Agent
 * process can plant such a link and it runs as this server's uid, so this is consistency rather
 * than a privilege boundary; it costs one resolution per message that carries attachments.
 *
 * The check is on the canonical path but the write stays on the logical one: the path travels
 * into the message text, and the read/delete endpoints address a Session by its logical
 * directory, so canonicalizing here would only make those disagree on hosts where the data root
 * itself sits behind a link (macOS `/var`, a Windows 8.3 temp path).
 */
async function openScratchpadDir(root: string, sessionId: string): Promise<string> {
  const dir = path.join(root, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const canonicalRoot = await fs.realpath(root);
  const rel = path.relative(canonicalRoot, await fs.realpath(dir));
  if (rel !== sessionId) {
    throw new Error(
      `session scratchpad ${dir} resolves outside the agent scratchpad root; refusing to write attachments`,
    );
  }
  return dir;
}

/** Best-effort undo of a batch of writes; errors are swallowed because every caller is already on an error path (a failed cleanup must not replace the original failure). */
export async function removeAttachments(files: string[]): Promise<void> {
  await Promise.all(files.map((f) => fs.rm(f, { force: true }).catch(() => {})));
}

/** Result of a write batch: the Prompt to run, plus the paths written so the caller can undo them if the Task never starts. */
export interface AttachedFiles {
  input: OmniMessage[];
  written: string[];
}

/**
 * Land every attachment in the Session scratchpad under `root` and return the Prompt with one
 * `[attached file: <path>]` line appended per file. Placement follows core's shared rule
 * (after the last user text message; attachments-only input becomes a line-only text
 * message), so a Prompt carrying both images and files still ends in a single trailing block.
 * Returns `messages` untouched when there is nothing to attach — no directory is created.
 *
 * All-or-nothing: a failure part-way through the batch removes what it already wrote, so a 500
 * never leaves files on disk that no message refers to. The caller owns the other half of that
 * guarantee — if starting the Task fails afterwards it must call removeAttachments(written),
 * otherwise the user's retry would land a second copy of every file.
 */
export async function attachFilesToInput(
  messages: OmniMessage[],
  attachments: TaskAttachment[],
  root: string,
  sessionId: string,
): Promise<AttachedFiles> {
  if (attachments.length === 0) return { input: messages, written: [] };
  const dir = await openScratchpadDir(root, sessionId);
  const written: string[] = [];
  try {
    // Sequential on purpose: the exclusive-create retry above resolves collisions against files
    // that already exist, and writing the batch one at a time keeps two same-named uploads in
    // the same message from racing each other for the plain name.
    for (const attachment of attachments) {
      written.push(await writeAttachment(dir, attachment));
    }
  } catch (err) {
    await removeAttachments(written);
    throw err;
  }
  return {
    input: appendAttachmentLines(
      messages,
      written.map((filePath) => attachedFileLine(modelVisiblePath(filePath))),
    ),
    written,
  };
}
