/**
 * Vendors Doodle's CJK face, LXGW WenKai GB Screen, into the Doodle pack
 * (`src/themes/doodle/`, whose `fonts/` folder `vendored-fonts.json` names): the woff2 slices of
 * the pinned `lxgw-wenkai-screen-web` release that hold any GB2312 character, copied byte for
 * byte into `fonts/`, and their `@font-face` rules as the pack's `fonts.css`. A pack's
 * `fonts.css` holds `@font-face` rules alone, each naming one of its own `fonts/*.woff2`: the shape
 * an export of the pack takes and an import is checked against. The folder holds the slices
 * alone; a write replaces it, and the sheet, whole.
 *
 *   node packages/ui/scripts/vendor-wenkai.mjs           rewrite the pack's fonts/ and fonts.css
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
 * that file and names it by a path relative to the sheet.
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
const sheetPath = join(outDir, "..", "fonts.css");
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
  "/**\n" +
  ` * Doodle's own faces: LXGW WenKai GB Screen ${manifest.version}, its Han face, 400 — the ${faces.length} slices\n` +
  ` * of ${manifest.package.replace(/.*\/-\//, "")} that hold any GB2312 character, in this pack's fonts/.\n` +
  " * Written by scripts/vendor-wenkai.mjs — do not edit by hand. SIL OFL 1.1, with the author's\n" +
  " * permission for web-delivery subsets to keep the font's name: src/fonts/LICENSES/lxgw-wenkai-gb-screen.txt.\n" +
  " *\n" +
  " * A pack's fonts.css names only the pack's own fonts/*.woff2, so this is the sheet an export of\n" +
  " * Doodle carries. Its Latin face, Shantell Sans, comes from a font package the app shares, as\n" +
  " * Console's faces do, and is declared beside the app's other faces in src/fonts/shantell-sans.css.\n" +
  " * Frost's recipes turn weight synthesis off, so a bold title's Han stays in the one weight it\n" +
  " * ships. fonts/index.css imports this sheet; the pack's index.css does not, so the faces stay out\n" +
  " * of the published styles.css. The url()s are relative to this file on purpose — see\n" +
  " * src/fonts/index.css.\n" +
  " */\n" +
  faces
    .map(
      ({ file, range }) =>
        `@font-face {\n  font-family: "LXGW WenKai GB Screen";\n  font-style: normal;\n` +
        `  font-weight: 400;\n  font-display: swap;\n  src: url("./fonts/${file}") format("woff2");\n` +
        `  unicode-range: ${range};\n}\n`,
    )
    .join("");

const expected = new Map();
for (const { file, bytes } of faces) expected.set(file, bytes);

if (check) {
  const present = existsSync(outDir) ? readdirSync(outDir) : [];
  const problems = [];
  for (const [name, bytes] of expected) {
    const path = join(outDir, name);
    if (!existsSync(path)) problems.push(`missing fonts/${name}`);
    else if (!readFileSync(path).equals(bytes)) problems.push(`differs fonts/${name}`);
  }
  for (const name of present) if (!expected.has(name)) problems.push(`extra fonts/${name}`);
  if (!existsSync(sheetPath)) problems.push("missing fonts.css");
  else if (readFileSync(sheetPath, "utf8") !== sheet) problems.push("differs fonts.css");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`vendor-wenkai: ${faces.length} slices and fonts.css match ${manifest.package}`);
} else {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of expected) writeFileSync(join(outDir, name), bytes);
  writeFileSync(sheetPath, sheet);
  const total = faces.reduce((sum, face) => sum + face.bytes.length, 0);
  console.log(`vendor-wenkai: wrote ${faces.length} slices (${total} bytes) and fonts.css`);
}
