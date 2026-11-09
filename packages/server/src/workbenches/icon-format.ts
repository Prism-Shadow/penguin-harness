/**
 * The image formats a workbench's App Center icon may come in, told apart by their first bytes.
 * A file name is only a claim: the icon is served under the content type its bytes are, so the
 * name and the bytes must agree. SVG, the one text format, is recognised by its `<svg` root after
 * an optional byte-order mark, XML declaration, comments and whitespace.
 *
 * Server-local for now: to be replaced by the shared icon-format module once that lands.
 */

export type IconFormat = "svg" | "png" | "jpeg" | "webp" | "gif" | "avif";

/** The most an icon may weigh, whatever its format. */
export const ICON_MAX_BYTES = 256 * 1024;

/** The content type each format is served under. */
export const ICON_CONTENT_TYPES: Readonly<Record<IconFormat, string>> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** What each format is called in a message. */
export const ICON_FORMAT_NAMES: Readonly<Record<IconFormat, string>> = {
  svg: "SVG",
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  gif: "GIF",
  avif: "AVIF",
};

/** What each extension claims; `.jpg` and `.jpeg` both claim JPEG. */
const CLAIMED_FORMAT: Readonly<Record<string, IconFormat>> = {
  svg: "svg",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
};

/** The extensions an icon may end in, for the message that says so. */
export const ICON_EXTENSIONS_TEXT = ".svg, .png, .jpg, .jpeg, .webp, .gif or .avif";

/** The format a file name claims by its extension, or null when it claims none of the six. */
export function iconFormatOfName(name: string): IconFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CLAIMED_FORMAT, ext) ? CLAIMED_FORMAT[ext]! : null;
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

/** An ISO-BMFF `ftyp` box whose major or a compatible brand is AVIF (`avif` or `avis`). */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxEnd = Math.min(view.getUint32(0), bytes.length);
  // The major brand at 8, the minor version at 12 (not a brand), the compatible brands from 16.
  for (let at = 8; at + 4 <= boxEnd; at += at === 8 ? 8 : 4) {
    const brand = ascii(bytes, at, at + 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/**
 * Whether the bytes are an SVG document: UTF-8 text with nothing but a byte-order mark, the XML
 * declaration, comments and whitespace before the `<svg` root element.
 */
function isSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return false;
  }
  let rest = text.replace(/^﻿/, "").replace(/^\s*<\?xml[^>]*\?>/i, "");
  for (;;) {
    rest = rest.replace(/^\s+/, "");
    if (!rest.startsWith("<!--")) break;
    const end = rest.indexOf("-->", 4);
    if (end < 0) return false;
    rest = rest.slice(end + 3);
  }
  return /^<svg[\s/>]/i.test(rest);
}

/** The format the bytes are, or null when they are none of the six. */
export function sniffIconFormat(bytes: Uint8Array): IconFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "webp";
  }
  if (isAvif(bytes)) return "avif";
  return isSvg(bytes) ? "svg" : null;
}
