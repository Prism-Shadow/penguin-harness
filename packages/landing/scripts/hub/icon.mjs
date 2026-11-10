/**
 * A plugin's icon for the site: the file its card names, else the first `icon.<ext>` at the
 * package root, carried as a data URL with whether it takes the text colour. The rules are the
 * plugin library's (core's plugin/icon-format.ts and plugin/icon-svg.ts), repeated here because
 * this build reads the packages without core: the format is told by the bytes, which must agree
 * with the name; a monochrome SVG — every paint `currentColor` or `none` — is drawn as a mask in
 * the tile's ink, anything else as itself. These are this repository's own plugins, so an icon
 * that breaks the rules fails the build rather than going missing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The icon file names a package root may hold, in the order the library looks for them. */
const ICON_FILES = [
  "icon.svg",
  "icon.png",
  "icon.webp",
  "icon.avif",
  "icon.jpg",
  "icon.jpeg",
  "icon.gif",
];
const MAX_ICON_BYTES = 256 * 1024;
const CLAIMED = {
  svg: "svg",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
};
const CONTENT_TYPE = {
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

/** The SVG text when the bytes are one: a `<svg` root after a BOM, an XML declaration, comments. */
function svgText(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let rest = text.replace(/^﻿/, "").replace(/^\s*<\?xml[^>]*\?>/i, "");
  for (;;) {
    rest = rest.replace(/^\s+/, "");
    if (!rest.startsWith("<!--")) break;
    const end = rest.indexOf("-->", 4);
    if (end < 0) return null;
    rest = rest.slice(end + 3);
  }
  return /^<svg[\s/>]/i.test(rest) ? text : null;
}

function isAvif(bytes) {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const size = Math.min(bytes.readUInt32BE(0), bytes.length);
  for (let at = 8; at + 4 <= size; at += at === 8 ? 8 : 4) {
    if (["avif", "avis"].includes(ascii(bytes, at, at + 4))) return true;
  }
  return false;
}

/** The format the bytes are, or null when they are no icon format. */
function sniff(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "webp";
  if (isAvif(bytes)) return "avif";
  return svgText(bytes) !== null ? "svg" : null;
}

const PAINTS = "fill|stroke|color|stop-color|flood-color|lighting-color";
const PAINT_ATTRIBUTE = new RegExp(
  `(?:^|[\\s"'/])(?:${PAINTS})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`,
  "gi",
);
const PAINT_DECLARATION = new RegExp(`(?:^|[\\s;{"'])(?:${PAINTS})\\s*:\\s*([^;}"'<>]+)`, "gi");

/** Whether an SVG names a paint and every paint it names is `currentColor` or `none`. */
function isMonochrome(text) {
  const values = [
    ...[...text.matchAll(PAINT_ATTRIBUTE)].map((m) => m[1] ?? m[2] ?? m[3] ?? ""),
    ...[...text.matchAll(PAINT_DECLARATION)].map((m) => m[1] ?? ""),
  ].map((v) =>
    v
      .replace(/!important/i, "")
      .trim()
      .toLowerCase(),
  );
  return (
    values.includes("currentcolor") && values.every((v) => v === "currentcolor" || v === "none")
  );
}

/** The package's icon as `{ url, tint }`, or undefined when it ships none. */
export function readPluginIcon(dir, declared) {
  const names = declared === undefined ? ICON_FILES : [declared];
  for (const name of names) {
    const file = join(dir, name);
    if (!existsSync(file)) {
      if (declared !== undefined) throw new Error(`${file}: the card's icon does not exist`);
      continue;
    }
    const bytes = readFileSync(file);
    const claimed = CLAIMED[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];
    const format = sniff(bytes);
    if (bytes.length > MAX_ICON_BYTES) throw new Error(`${file}: an icon is at most 256 KB`);
    if (format === null || format !== claimed) {
      throw new Error(`${file}: its bytes are not the image format its name says`);
    }
    if (format === "svg") {
      const text = bytes.toString("utf8");
      return {
        url: `data:image/svg+xml,${encodeURIComponent(text.trim())}`,
        tint: isMonochrome(text),
      };
    }
    return { url: `data:${CONTENT_TYPE[format]};base64,${bytes.toString("base64")}`, tint: false };
  }
  return undefined;
}
