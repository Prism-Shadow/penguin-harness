/**
 * Vendors Doodle's CJK face, LXGW WenKai GB Screen, into the Doodle pack's `fonts/` folder
 * (`src/themes/doodle/fonts/`, as `vendored-fonts.json` names it): the woff2 slices of the pinned
 * `lxgw-wenkai-screen-web` release that hold any GB2312 character, copied byte for byte, and
 * `wenkai.css`, their `@font-face` rules. The folder holds nothing else: a write replaces it whole.
 *
 *   node packages/ui/scripts/vendor-wenkai.mjs           rewrite the pack's fonts/
 *   node packages/ui/scripts/vendor-wenkai.mjs --check   exit 1 on any difference, write nothing
 *
 * `--check` downloads the 57 MB tarball again to compare; run it when the manifest changes, not
 * as part of a test.
 *
 * The package slices the font by character frequency, 259 files in all (13.7 MB). Every
 * character of the GB2312 grid — the standard's 7,445, the 6,763 commonest Han among them, and the
 * few symbols GBK later placed in the grid's empty cells — sits in 48 of them (2.8 MB); the rest
 * carry rare ideographs, Hangul and symbols, which fall back to Noto Sans SC and then the
 * platform's face in the theme's stack. Each kept file is the package's
 * own, unmodified; a `@font-face` here keeps the package's family, weight and `unicode-range` for
 * that file and names it by a path relative to this stylesheet.
 *
 * The licence (SIL OFL 1.1, with the author's permission for web-delivery subsets to keep the
 * font's reserved names) is transcribed in `src/fonts/LICENSES/lxgw-wenkai-gb-screen.txt` and
 * listed in `src/fonts/vendored-fonts.json`, which also pins the release this script reads.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "src", "fonts", "vendored-fonts.json"), "utf8"),
).wenkai;
const outDir = join(packageRoot, manifest.files);
const check = process.argv.includes("--check");
const SLICE_DIR = "package/lxgwwenkaigbscreen/";

/** Reads a ustar archive into a map of path → bytes (regular files only). */
function untar(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const name = text(345, 155) ? `${text(345, 155)}/${text(0, 100)}` : text(0, 100);
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    offset += 512;
    if (type === "0" || type === "") files.set(name, buffer.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every character GB2312 encodes, decoded through its superset GBK. */
function gb2312() {
  const decoder = new TextDecoder("gbk", { fatal: true });
  const chars = new Set();
  for (let hi = 0xa1; hi <= 0xf7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      try {
        const ch = decoder.decode(Uint8Array.of(hi, lo));
        if (ch.length > 0 && ch !== "�") chars.add(ch.codePointAt(0));
      } catch {
        // An unassigned cell of the GB2312 grid.
      }
    }
  }
  return chars;
}

function codePoints(range) {
  const points = new Set();
  for (const part of range.split(",")) {
    const [from, to] = part.trim().replace(/^U\+/i, "").split("-");
    const start = Number.parseInt(from, 16);
    const end = to === undefined ? start : Number.parseInt(to, 16);
    for (let cp = start; cp <= end; cp++) points.add(cp);
  }
  return points;
}

const response = await fetch(manifest.package);
if (!response.ok) throw new Error(`fetch ${manifest.package}: ${response.status}`);
const tarball = Buffer.from(await response.arrayBuffer());
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
if (integrity !== manifest.packageIntegrity) {
  throw new Error(
    `${manifest.package}: integrity ${integrity}, expected ${manifest.packageIntegrity}`,
  );
}
const files = untar(gunzipSync(tarball));
const css = files.get(`${SLICE_DIR}result.css`)?.toString("utf8");
if (css === undefined) throw new Error(`${SLICE_DIR}result.css is not in the package`);

const wanted = gb2312();
const faces = [];
for (const match of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
  const body = match[1];
  const file = /url\("\.\/([^"]+\.woff2)"\)/.exec(body)?.[1];
  const range = /unicode-range:([^;}]+)/.exec(body)?.[1];
  if (file === undefined || range === undefined) throw new Error(`unreadable face: ${body}`);
  const points = codePoints(range);
  if (![...points].some((cp) => wanted.has(cp))) continue;
  faces.push({ file, range: range.trim(), bytes: files.get(`${SLICE_DIR}${file}`) });
}
faces.sort((a, b) => Number.parseInt(a.file, 10) - Number.parseInt(b.file, 10));

const sheet =
  `/**\n * LXGW WenKai GB Screen ${manifest.version}, Doodle's CJK face: the ${faces.length} slices of\n` +
  ` * ${manifest.package.replace(/.*\/-\//, "")} that hold any GB2312 character, written by\n` +
  " * scripts/vendor-wenkai.mjs — do not edit by hand. SIL OFL 1.1: src/fonts/LICENSES/lxgw-wenkai-gb-screen.txt.\n */\n" +
  faces
    .map(
      ({ file, range }) =>
        `@font-face {\n  font-family: "LXGW WenKai GB Screen";\n  font-style: normal;\n` +
        `  font-weight: 400;\n  font-display: swap;\n  src: url("./${file}") format("woff2");\n` +
        `  unicode-range: ${range};\n}\n`,
    )
    .join("");

const expected = new Map([["wenkai.css", Buffer.from(sheet)]]);
for (const { file, bytes } of faces) expected.set(file, bytes);

if (check) {
  const present = existsSync(outDir) ? readdirSync(outDir) : [];
  const problems = [];
  for (const [name, bytes] of expected) {
    const path = join(outDir, name);
    if (!existsSync(path)) problems.push(`missing ${name}`);
    else if (!readFileSync(path).equals(bytes)) problems.push(`differs ${name}`);
  }
  for (const name of present) if (!expected.has(name)) problems.push(`extra ${name}`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`vendor-wenkai: ${faces.length} slices match ${manifest.package}`);
} else {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of expected) writeFileSync(join(outDir, name), bytes);
  const total = faces.reduce((sum, face) => sum + face.bytes.length, 0);
  console.log(`vendor-wenkai: wrote ${faces.length} slices (${total} bytes) and wenkai.css`);
}
