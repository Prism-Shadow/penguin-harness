/**
 * The image formats an icon may come in, told apart by their first bytes. A file name is only a
 * claim: what is stored is served back under the content type the bytes say, so a name and its
 * bytes must agree. SVG, the one text format, is recognised by its `<svg` root after an optional
 * byte-order mark, XML declaration, comments and whitespace.
 */

/** The six formats an icon may be. */
export type IconFormat = "svg" | "png" | "jpeg" | "webp" | "gif" | "avif";

/** The most an icon may weigh, whatever its format. */
export const MAX_ICON_BYTES = 256 * 1024;

/** The content type each format is served under. */
export const ICON_CONTENT_TYPES: Readonly<Record<IconFormat, string>> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** The extension an icon of each format is written with (`icon.<ext>`). */
const WRITTEN_EXTENSION: Readonly<Record<IconFormat, string>> = {
  svg: "svg",
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
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

/**
 * The icon file names a directory may hold, in the order a reader looks for them: an installed
 * Skill or hook package carries one, `icon.<ext>`, and a package root may carry one instead of
 * naming its icon in the card.
 */
export const ICON_FILE_NAMES: readonly string[] = [
  "icon.svg",
  "icon.png",
  "icon.webp",
  "icon.avif",
  "icon.jpg",
  "icon.jpeg",
  "icon.gif",
];

/** The extensions a card's `icon` may end in, for the message that says so. */
export const ICON_EXTENSIONS_TEXT = ".svg, .png, .jpg, .jpeg, .webp, .gif or .avif";

/** The format a file name claims by its extension, or null when it claims none of the six. */
export function iconFormatOfName(name: string): IconFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return CLAIMED_FORMAT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** The name an icon of this format is written under: `icon.svg`, `icon.png`, `icon.jpg`, … */
export function iconFileName(format: IconFormat): string {
  return `icon.${WRITTEN_EXTENSION[format]}`;
}

/** Whether a path relative to a Skill or hook package directory is one of its icon files. */
export function isIconFileName(rel: string): boolean {
  return ICON_FILE_NAMES.includes(rel.toLowerCase());
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

/** ISO-BMFF `ftyp` box whose major or a compatible brand is AVIF (`avif` still, `avis` sequence). */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = Math.min(view.getUint32(0), bytes.length);
  for (let at = 8; at + 4 <= boxSize; at += at === 8 ? 8 : 4) {
    const brand = ascii(bytes, at, at + 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/**
 * The text of an SVG document from its `<svg` root on, or null when the bytes are not one: not
 * UTF-8, or something other than a byte-order mark, the XML declaration, comments and whitespace
 * before the root element.
 */
export function svgRootOf(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let rest = text.replace(/^﻿/, "");
  rest = rest.replace(/^\s*<\?xml[^>]*\?>/i, "");
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (!trimmed.startsWith("<!--")) {
      rest = trimmed;
      break;
    }
    const end = trimmed.indexOf("-->", 4);
    if (end < 0) return null;
    rest = trimmed.slice(end + 3);
  }
  return /^<svg[\s/>]/i.test(rest) ? rest : null;
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
  return svgRootOf(bytes) !== null ? "svg" : null;
}
