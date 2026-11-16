/**
 * An avatar kept as an image file — an employee's in its organization's `avatars/`
 * (organization/avatars.ts), an Agent's own in its Agent State (agent-avatar.ts). One rule for
 * both, and the formats and the cap an account's avatar has (http/routes/me.ts): a png, jpeg or
 * webp arriving as a data URL of at most {@link AVATAR_MAX_CHARS} characters. The Web App's
 * picker re-encodes to fit, so one picker serves every avatar.
 *
 * A file rather than a column, like everything else its owner is made of: it can be dropped in
 * by hand and it goes wherever its directory goes. So the bytes are checked on the way in (the
 * data URL's label is a claim, and what is stored is served back under it), and a file dropped
 * in larger than {@link AVATAR_MAX_BYTES} is ignored rather than served. An owner has at most
 * one, whatever the format: a write removes the other formats' files once the new one is in
 * place.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { TMP_SUFFIX } from "../workbenches/store.js";

// Same cap as a user's avatar, measured on the data URL as it arrives (≈ 96 KiB of image).
import { AVATAR_MAX_CHARS } from "../api/types.js";
/** A file dropped in by hand is served up to this size; a larger one is ignored. */
const AVATAR_MAX_BYTES = 256 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const EXT = { png: "png", jpeg: "jpg", webp: "webp" } as const;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** An image ready to be stored: the file extension its format takes, and its bytes. */
export interface AvatarImage {
  ext: string;
  bytes: Buffer;
}

/** A stored avatar as it is served: its bytes, their type, and the content revision. */
export interface StoredAvatar {
  bytes: Buffer;
  mime: string;
  /** Changes with the content: a URL carrying it names one image, so it is cached for good. */
  rev: string;
}

/** The image a data URL holds, or why it cannot be an avatar. */
export function parseAvatarDataUrl(
  raw: string,
): ({ ok: true } & AvatarImage) | { ok: false; error: string } {
  if (raw.length > AVATAR_MAX_CHARS) {
    return { ok: false, error: `avatar is at most ${AVATAR_MAX_CHARS} characters as a data URL` };
  }
  const m = DATA_URL.exec(raw);
  if (m === null) return { ok: false, error: "avatar must be a png, jpeg or webp data URL" };
  const format = m[1] as keyof typeof EXT;
  const bytes = Buffer.from(m[2]!, "base64");
  if (!holdsFormat(bytes, format)) return { ok: false, error: `avatar is not a ${format} image` };
  return { ok: true, ext: EXT[format], bytes };
}

/**
 * Whether the bytes start the way the declared format does — the same signatures the CLI reads
 * a file's type by (`imageMime` in its org command).
 */
function holdsFormat(bytes: Buffer, format: keyof typeof EXT): boolean {
  switch (format) {
    case "png":
      return bytes.subarray(0, 8).equals(PNG_SIGNATURE);
    case "jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "webp":
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
  }
}

/** `<dir>/<stem>.<ext>` for every format the owner has a file in, png first. */
async function existing(dir: string, stem: string): Promise<{ file: string; stat: Stats }[]> {
  const out: { file: string; stat: Stats }[] = [];
  for (const ext of Object.keys(MIME)) {
    const file = path.join(dir, `${stem}.${ext}`);
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) out.push({ file, stat });
    } catch {
      // Not that format.
    }
  }
  return out;
}

const revOf = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 12);

/** The avatar `<dir>/<stem>.<ext>`, or null when there is none (or one too large to serve). */
export async function readAvatarFile(dir: string, stem: string): Promise<StoredAvatar | null> {
  const [found] = await existing(dir, stem);
  if (found === undefined || found.stat.size > AVATAR_MAX_BYTES) return null;
  const bytes = await fs.readFile(found.file);
  if (bytes.byteLength > AVATAR_MAX_BYTES) return null;
  return { bytes, mime: MIME[path.extname(found.file).slice(1)]!, rev: revOf(bytes) };
}

/**
 * What a list says about an avatar: its revision, or undefined when there is none. A list is
 * read far more often than an avatar changes, so the revision is remembered per file against
 * its identity, size and modification time, and the bytes are hashed again only when one of
 * those moves.
 */
export async function avatarFileRev(dir: string, stem: string): Promise<string | undefined> {
  const [found] = await existing(dir, stem);
  if (found === undefined || found.stat.size > AVATAR_MAX_BYTES) return undefined;
  const { ino, size, mtimeMs } = found.stat;
  const seen = `${ino}:${size}:${mtimeMs}`;
  const known = revisions.get(found.file);
  if (known?.seen === seen) return known.rev;
  const avatar = await readAvatarFile(dir, stem);
  if (avatar === null) return undefined;
  remember(found.file, { seen, rev: avatar.rev });
  return avatar.rev;
}

/** Revisions by file, at most {@link REVISIONS_KEPT} of them, the oldest dropped first. */
const revisions = new Map<string, { seen: string; rev: string }>();
const REVISIONS_KEPT = 1024;
function remember(file: string, entry: { seen: string; rev: string }): void {
  revisions.delete(file);
  revisions.set(file, entry);
  if (revisions.size > REVISIONS_KEPT) revisions.delete(revisions.keys().next().value!);
}

/** One write at a time per owner, so two writes in other formats cannot both be left standing. */
const writes = new Map<string, Promise<void>>();

/** Replaces the avatar `<dir>/<stem>.<ext>`; `null` removes it. One file per owner, whatever the format. */
export function writeAvatarFile(
  dir: string,
  stem: string,
  image: AvatarImage | null,
): Promise<void> {
  const key = path.join(dir, stem);
  const run = (writes.get(key) ?? Promise.resolve()).then(() => write(dir, stem, image));
  const settled = run.catch(() => undefined);
  writes.set(key, settled);
  void settled.then(() => {
    if (writes.get(key) === settled) writes.delete(key);
  });
  return run;
}

async function write(dir: string, stem: string, image: AvatarImage | null): Promise<void> {
  let kept: string | null = null;
  if (image !== null) {
    await fs.mkdir(dir, { recursive: true });
    kept = path.join(dir, `${stem}.${image.ext}`);
    // Staged under the server's temporary suffix, which a snapshot of the Agent State leaves out.
    const staged = `${kept}${TMP_SUFFIX}${randomBytes(6).toString("hex")}`;
    await fs.writeFile(staged, image.bytes);
    await fs.rename(staged, kept);
  }
  for (const { file } of await existing(dir, stem)) {
    if (file !== kept) await fs.rm(file, { force: true });
  }
}
