/**
 * The media questions every messaging channel has to answer the same way: which files the
 * chat should render as a picture rather than offer as an attachment, what MIME type a
 * downloaded image's bytes carry, and how to read a download without letting the remote
 * side decide how much memory it may use.
 *
 * It sits beside the connectors instead of inside one because the answers must not differ
 * per channel: a `.png` the Agent wrote has to arrive as a picture in Feishu AND in
 * Telegram, or the same reply reads differently depending on where it landed. The
 * connectors keep only what is genuinely channel-shaped (which endpoint, which field
 * name); the classification lives here.
 */

/**
 * The extensions sent as an image, mapped to the MIME type that names them.
 *
 * Deliberately the intersection of what both channels' image endpoints accept and both
 * clients render inline — Feishu's upload also takes BMP/ICO/TIFF/HEIC and Telegram's
 * `sendPhoto` re-encodes what it is given, but a set that holds on one channel and not the
 * other would make the same reply look different in two chats. SVG is excluded on purpose:
 * neither channel renders it as a picture, and it is a scriptable document (see
 * WorkspaceFileContent.scriptable) — it travels as a file attachment instead.
 */
const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The MIME type implied by a file name's extension, or null when it is not one of the image kinds. */
export function imageMimeOfName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Whether a file name should be sent as a picture (see IMAGE_MIME_BY_EXT for the set and why). */
export function isImageFileName(name: string): boolean {
  return imageMimeOfName(name) !== null;
}

/**
 * The image type the bytes themselves declare, or null for anything unrecognized.
 *
 * An inbound download names its type unreliably — Feishu's resource endpoint answers with
 * whatever content type the sender's upload carried, and a channel that answers
 * `application/octet-stream` would otherwise produce a data URL no provider accepts. The
 * magic bytes are the one source that cannot be wrong, so they win where they are
 * conclusive and the header stays the fallback.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  // RIFF....WEBP — the four-byte size field between the two tags is not part of the tag.
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * A transfer refused for its size, as opposed to one that failed.
 *
 * The distinction exists because the two have nothing in common but the outcome, and the
 * user's next move differs: a size refusal is theirs to fix by sending something smaller,
 * while a failure is a fault somewhere else — a permission the bot was never granted, a
 * network blip — that no amount of resending will clear. A notice that covers both says
 * neither, which is how a real permission error was first reported to us as "the image is
 * too large or the download failed".
 */
export class MessagingMediaTooLargeError extends Error {
  constructor(what: string, maxBytes: number) {
    super(`${what} is larger than the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
    this.name = "MessagingMediaTooLargeError";
  }
}

/**
 * Reads a download into memory, refusing at the byte that crosses `maxBytes`.
 *
 * Buffering `await res.arrayBuffer()` and checking the length afterwards would be a
 * remote-controlled allocation: a declared size is a claim, and both channels can serve
 * far more than this server wants to hold (Feishu's resource endpoint goes to 100MB). The
 * count is kept over the chunks actually received, so a lying `content-length` — or none
 * at all — buys nothing.
 *
 * `what` names the transfer in the error message; it must never carry a URL, since
 * Telegram's file endpoint embeds the bot token in one.
 */
export async function collectUnderCap(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
  what: string,
): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new MessagingMediaTooLargeError(what, maxBytes);
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
