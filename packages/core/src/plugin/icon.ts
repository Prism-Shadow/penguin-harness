/**
 * Icons: a plugin's, in its package, and the copy an install writes beside every Skill and hook
 * package it ships (`icon.<ext>`), or a user-authored Skill's own. An icon is an image — SVG, PNG,
 * JPEG, WebP, GIF or AVIF, recognised by its bytes (./icon-format.ts) — of at most
 * MAX_ICON_BYTES; an SVG must also pass the deny-list and is marked `tint` when monochrome
 * (./icon-svg.ts). Anything else costs its owner the icon (the UI's glyph for the kind), never
 * the page its safety: the Web App only ever draws an icon as an image, from a URL the server
 * serves it at.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  ICON_EXTENSIONS_TEXT,
  ICON_FILE_NAMES,
  MAX_ICON_BYTES,
  iconFormatOfName,
  sniffIconFormat,
} from "./icon-format.js";
import type { IconFormat } from "./icon-format.js";
import { isSafeIconSvg, isTintableSvg } from "./icon-svg.js";

/** An icon that reads clean: its format (from its bytes), its bytes, and whether it takes the text colour. */
export interface IconImage {
  format: IconFormat;
  bytes: Uint8Array;
  /** A monochrome SVG (every paint `currentColor` or `none`): drawn as a mask in the text colour. Otherwise drawn as itself. */
  tint: boolean;
}

/**
 * Checks an icon's bytes against the name they came under: a format the name claims, bytes of
 * that same format, at most MAX_ICON_BYTES, and for an SVG nothing the deny-list names. The
 * problem says which of those failed, for a warning.
 */
export function iconImage(
  bytes: Uint8Array,
  name: string,
): { icon: IconImage } | { problem: string } {
  if (bytes.byteLength > MAX_ICON_BYTES) {
    return { problem: `is larger than ${MAX_ICON_BYTES / 1024} KB` };
  }
  const claimed = iconFormatOfName(name);
  if (claimed === null) return { problem: `is not a ${ICON_EXTENSIONS_TEXT} file` };
  const format = sniffIconFormat(bytes);
  if (format !== claimed) {
    return {
      problem:
        format === null
          ? `is not a ${claimed.toUpperCase()} image (its bytes are no image format an icon may be)`
          : `is named as ${claimed.toUpperCase()} but its bytes are ${format.toUpperCase()}`,
    };
  }
  if (format !== "svg") return { icon: { format, bytes, tint: false } };
  const text = new TextDecoder().decode(bytes);
  if (!isSafeIconSvg(text)) {
    return {
      problem:
        "is not a plain SVG (script, animation, event handlers, links and external references are refused)",
    };
  }
  return { icon: { format, bytes, tint: isTintableSvg(text) } };
}

/** A plain file's bytes when it is one (a symlink is not followed) within the size cap; why not otherwise. */
function readPlainFile(file: string): { bytes: Uint8Array } | { problem: string } | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return { problem: "is not a plain file" };
  if (stat.size > MAX_ICON_BYTES) return { problem: `is larger than ${MAX_ICON_BYTES / 1024} KB` };
  return { bytes: new Uint8Array(fs.readFileSync(file)) };
}

/**
 * A package's icon: the file its card's `icon` names, else the first of ICON_FILE_NAMES at the
 * package root. Read only when the file stays inside the package (a symlink is not followed) and
 * reads clean (iconImage); otherwise no icon (the UI's puzzle glyph), with a warning saying why.
 * A package with no icon at all has none, silently.
 */
export function readPluginIcon(
  dir: string,
  declared: string | undefined,
): { icon?: IconImage; warnings: string[] } {
  if (declared === undefined) {
    for (const name of ICON_FILE_NAMES) {
      const read = readPlainFile(path.join(dir, name));
      if (read === null) continue;
      if ("problem" in read) return { warnings: [`${name} ${read.problem}; ignored`] };
      const checked = iconImage(read.bytes, name);
      if ("problem" in checked) return { warnings: [`${name} ${checked.problem}; ignored`] };
      return { icon: checked.icon, warnings: [] };
    }
    return { warnings: [] };
  }
  const key = `card.icon (${declared})`;
  const abs = path.resolve(dir, declared);
  const inside = path.relative(dir, abs);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    return { warnings: [`${key} is not a file inside the package; ignored`] };
  }
  const read = readPlainFile(abs);
  if (read === null) return { warnings: [`${key} does not exist; ignored`] };
  if ("problem" in read) return { warnings: [`${key} ${read.problem}; ignored`] };
  const checked = iconImage(read.bytes, declared);
  if ("problem" in checked) return { warnings: [`${key} ${checked.problem}; ignored`] };
  return { icon: checked.icon, warnings: [] };
}

/**
 * The icon an installed Skill or hook package carries in its directory: the first of
 * ICON_FILE_NAMES there that is a plain file (a symlink is not followed) and reads clean. An
 * `icon.svg` written by an install before icons came in other formats is one of them, read the
 * same way. Undefined when there is none: the UI then draws the kind's glyph.
 */
export async function readInstalledIcon(dir: string): Promise<IconImage | undefined> {
  for (const name of ICON_FILE_NAMES) {
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = await fsp.lstat(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fsp.readFile(file));
    } catch {
      continue;
    }
    const checked = iconImage(bytes, name);
    if ("icon" in checked) return checked.icon;
  }
  return undefined;
}
