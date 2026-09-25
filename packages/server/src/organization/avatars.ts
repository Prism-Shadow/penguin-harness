/**
 * An employee's avatar: an image file in the organization directory, `avatars/<agent_id>.<ext>`.
 *
 * A file, like everything else an organization is made of — it can be dropped in by hand, it
 * goes wherever the directory goes — and the organization's rather than the Agent's, like the
 * employee's name: the same Agent may be pictured differently somewhere else. The formats and
 * the size are the ones a person's own avatar has (the picker re-encodes to fit), so one
 * picker serves both.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Same cap as a user's avatar, measured on the data URL as it arrives (≈ 96 KiB of image). */
export const AVATAR_MAX_CHARS = 131072;
/** A file dropped in by hand is served up to this size; a larger one is ignored. */
const AVATAR_MAX_BYTES = 256 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const EXT = { png: "png", jpeg: "jpg", webp: "webp" } as const;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function avatarsDir(dir: string): string {
  return path.join(dir, "avatars");
}

/** The image a data URL holds, or why it cannot be an avatar. */
export function parseAvatarDataUrl(
  raw: string,
): { ok: true; ext: string; bytes: Buffer } | { ok: false; error: string } {
  if (raw.length > AVATAR_MAX_CHARS) {
    return { ok: false, error: `avatar is at most ${AVATAR_MAX_CHARS} characters as a data URL` };
  }
  const m = DATA_URL.exec(raw);
  if (m === null) return { ok: false, error: "avatar must be a png, jpeg or webp data URL" };
  return { ok: true, ext: EXT[m[1] as keyof typeof EXT], bytes: Buffer.from(m[2]!, "base64") };
}

async function existing(dir: string, agentId: string): Promise<string[]> {
  const out: string[] = [];
  for (const ext of Object.keys(MIME)) {
    const file = path.join(avatarsDir(dir), `${agentId}.${ext}`);
    try {
      if ((await fs.stat(file)).isFile()) out.push(file);
    } catch {
      // Not that format.
    }
  }
  return out;
}

/** The employee's avatar, or null when it has none (or one too large to serve). */
export async function readAvatar(
  dir: string,
  agentId: string,
): Promise<{ bytes: Buffer; mime: string; rev: string } | null> {
  const [file] = await existing(dir, agentId);
  if (file === undefined) return null;
  const bytes = await fs.readFile(file);
  if (bytes.byteLength > AVATAR_MAX_BYTES) return null;
  return {
    bytes,
    mime: MIME[path.extname(file).slice(1)]!,
    rev: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
  };
}

/** Replaces the employee's avatar; `null` removes it. One file per employee, whatever the format. */
export async function writeAvatar(
  dir: string,
  agentId: string,
  image: { ext: string; bytes: Buffer } | null,
): Promise<void> {
  for (const file of await existing(dir, agentId)) await fs.rm(file, { force: true });
  if (image === null) return;
  await fs.mkdir(avatarsDir(dir), { recursive: true });
  const file = path.join(avatarsDir(dir), `${agentId}.${image.ext}`);
  await fs.writeFile(`${file}.tmp`, image.bytes);
  await fs.rename(`${file}.tmp`, file);
}
