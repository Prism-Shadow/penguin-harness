/**
 * A pack's binary files: its fonts and drawings, checked by their bytes, never by their names.
 *
 * Fonts are WOFF2 alone. The header and the table directory are read here, which bounds what a
 * malformed file can claim; the browser's OTS sanitiser, which parses every web font before the
 * font engine sees it, is the real defence, and the size caps bound the exposure to it. Drawings
 * (PNG, WebP, SVG) go through a plugin icon's check: the bytes are the format the name claims,
 * and an SVG holds no script, event handler or external reference. A drawing reaches the page as
 * a CSS image, where an SVG runs nothing anyway; the check covers the one other way it is seen,
 * opened on its own in a tab, where the serving route's sandbox applies too.
 */
import { invalid } from "./problem.js";
import { THEME_PACK_LIMITS } from "./limits.js";

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** A UIntBase128 (WOFF2 §4.1) at `at`: its value and the bytes it took, or null when malformed. */
function base128(bytes: Uint8Array, at: number): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at + i];
    if (byte === undefined) return null;
    // A leading 0x80 is a padded encoding, which the format forbids.
    if (i === 0 && byte === 0x80) return null;
    if (value > 0x01ffffff) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  return null;
}

/** The sfnt flavours a WOFF2 may wrap: TrueType, CFF, and Apple's TrueType tag. */
const FLAVOURS = new Set([0x00010000, 0x4f54544f, 0x74727565]);
const HEADER_BYTES = 48;

/** Why the bytes are not a WOFF2 font, or null when its header and table directory read clean. */
export function woff2Problem(bytes: Uint8Array): string | null {
  if (bytes.byteLength < HEADER_BYTES || ascii(bytes, 0, 4) !== "wOF2") {
    return "is not a WOFF2 font (its first bytes are not wOF2)";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flavour = view.getUint32(4);
  const length = view.getUint32(8);
  const tables = view.getUint16(12);
  const reserved = view.getUint16(14);
  const compressed = view.getUint32(20);
  if (!FLAVOURS.has(flavour)) return "is a WOFF2 of an unknown font flavour";
  if (length !== bytes.byteLength) return "is a WOFF2 whose header misstates its length";
  if (tables === 0 || reserved !== 0) return "is a WOFF2 with a malformed header";
  let at = HEADER_BYTES;
  for (let i = 0; i < tables; i++) {
    const flags = bytes[at];
    if (flags === undefined) return "is a WOFF2 whose table directory runs past the file";
    at += 1;
    const tag = flags & 0x3f;
    if (tag === 0x3f) at += 4;
    const original = base128(bytes, at);
    if (original === null) return "is a WOFF2 with a malformed table directory";
    at += original.size;
    // glyf and loca (known tags 10 and 11) are transformed unless their version is 3; every
    // other table is transformed unless its version is 0. A transformed table states its length.
    const version = flags >> 6;
    const transformed = tag === 10 || tag === 11 ? version !== 3 : version !== 0;
    if (transformed) {
      const size = base128(bytes, at);
      if (size === null) return "is a WOFF2 with a malformed table directory";
      at += size.size;
    }
  }
  if (at + compressed > bytes.byteLength) return "is a WOFF2 whose tables run past the file";
  return null;
}

/** Checks one file under `fonts/` or `art/`; throws the refusal that names it. */
export async function checkAsset(path: string, bytes: Uint8Array): Promise<void> {
  if (path.startsWith("fonts/")) {
    if (!path.endsWith(".woff2"))
      throw invalid(path, "a font is a .woff2 file; other formats are refused");
    if (bytes.byteLength > THEME_PACK_LIMITS.fontBytes) {
      throw invalid(path, `a font is at most ${THEME_PACK_LIMITS.fontBytes / 1024 / 1024} MiB`);
    }
    const problem = woff2Problem(bytes);
    if (problem !== null) throw invalid(path, problem);
    return;
  }
  const ext = path.slice(path.lastIndexOf(".") + 1);
  if (ext !== "svg" && ext !== "png" && ext !== "webp") {
    throw invalid(path, "a drawing is a .svg, .png or .webp file");
  }
  const cap = ext === "svg" ? THEME_PACK_LIMITS.svgBytes : THEME_PACK_LIMITS.imageBytes;
  if (bytes.byteLength > cap) {
    throw invalid(path, `a .${ext} drawing is at most ${cap / 1024} KiB`);
  }
  // A plugin icon's check: the bytes are the format the name claims, and an SVG holds nothing
  // its deny-list names. Loaded only when a pack carries a drawing, so a reader of a pack without
  // one (the UI package's suite over the built-ins) never loads the SDK.
  const { iconImage } = await import("@prismshadow/penguin-core");
  const checked = iconImage(bytes, path);
  if ("problem" in checked) throw invalid(path, checked.problem);
}
