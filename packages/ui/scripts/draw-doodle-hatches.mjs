/**
 * Draws the hatch tiles the Doodle theme lays over an HTML chart mark — a Trace timeline's or a
 * horizontal bar chart's bar, a legend's or a bubble's swatch — and writes them, as the custom
 * properties `src/themes/cartoon/charts.css` reads, into that file's generated block.
 *
 *   node packages/ui/scripts/draw-doodle-hatches.mjs          rewrite the block
 *   node packages/ui/scripts/draw-doodle-hatches.mjs --check  exit 1 if the block is stale
 *
 * An SVG bar is hatched by a pattern (`ChartDefs`): its colour's diagonal lines over a faint wash
 * of it. An HTML mark keeps its own paint as its background and takes one of these tiles over it:
 * a square of the slip (`--ui-surface`, read from `src/themes/cartoon.css` for each mode) at four
 * fifths of its strength, cut by one diagonal line (`/`, as the pattern runs) that lets the paint
 * through, so the mark shows the same picture — its colour's lines over a fifth of it, on the
 * paper — whatever colour it is painted. A tile `side` px square leaves its lines side/√2 apart.
 *
 * Each tile is a palette PNG at twice its size, rendered by `raster-strokes.mjs` (the slip's band
 * is a wide stroke along the middle of each gap). Drawn from an SVG, a tile is re-rendered with
 * every repaint of its mark; a swatch in a chart's bubble is repainted on every step of the
 * pointer, and SVG tiles there put the usage page's paint on hover at 1.5x Primer's.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng, pngPixels, rasterize } from "./raster-strokes.mjs";

const THEMES = fileURLToPath(new URL("../src/themes/", import.meta.url));
const TARGET = "cartoon/charts.css";
const MODES = ["light", "dark"];

/**
 * The tiles, by the side of their square in px: a palette slot's bar (its lines 5.7 px apart,
 * about the SVG hatch's 6) and the Token kinds' sparse and dense ones, then a swatch's, half as
 * wide on its eight pixels.
 */
const TILES = [
  ["--_hatch-bar", 8],
  ["--_hatch-bar-sparse", 11],
  ["--_hatch-bar-dense", 6],
  ["--_hatch-swatch", 4],
  ["--_hatch-swatch-sparse", 6],
  ["--_hatch-swatch-dense", 3],
];

/** The line the mark's paint shows through, px across. */
const LINE = 1;
/** The slip's strength in a band, in the PNG's alpha steps (of 15): four fifths. */
const BAND = 12;

/** The slip's colour in a mode, as `cartoon.css` declares it. */
function slip(mode) {
  const text = readFileSync(`${THEMES}cartoon.css`, "utf8");
  const dark = text.indexOf(':root[data-theme="cartoon"].dark {');
  const scope = mode === "dark" ? text.slice(dark) : text.slice(0, dark);
  const value = /--ui-surface:\s*(#[0-9a-f]{6})\s*;/i.exec(scope)?.[1];
  if (dark === -1 || value === undefined) {
    throw new Error(`themes/cartoon.css: no ${mode} --ui-surface as a #rrggbb colour`);
  }
  return value.toLowerCase();
}

/**
 * A tile: the slip in the two bands between the tile's diagonal lines (`x + y = 0` and
 * `x + y = 2·side` at its corners, `x + y = side` across it), each band a stroke along its middle
 * as wide as the gap less the line, run past the tile's edges so its ends fall outside.
 */
function tile(side, colour) {
  const half = side / 2;
  const width = side / Math.SQRT2 - LINE;
  const reach = 2;
  const lines = [
    [
      [-reach, half + reach],
      [half + reach, -reach],
    ],
    [
      [side + reach, half - reach],
      [half - reach, side + reach],
    ],
  ].map((points) => ({ points, closed: false }));
  const { side: px, levels } = rasterize({ size: side, scale: 2, width, lines });
  const band = levels.map((level) => Math.round((level * BAND) / 15));
  const data = encodePng({ side: px, levels: band }, colour);
  return `image-set(url("data:image/png;base64,${data.toString("base64")}") 2x)`;
}

const properties = (mode) => TILES.map(([name, side]) => [name, tile(side, slip(mode))]);

const BEGIN = "/* draw-doodle-hatches.mjs: begin generated block, do not edit by hand */";
const END = "/* draw-doodle-hatches.mjs: end generated block */";

function block() {
  const rule = (selector, props) =>
    `  ${selector} {\n${props.map(([name, value]) => `    ${name}: ${value};`).join("\n")}\n  }`;
  return [
    `  ${BEGIN}`,
    rule(':root[data-theme="cartoon"]', properties("light")),
    rule(':root[data-theme="cartoon"].dark', properties("dark")),
    `  ${END}`,
  ].join("\n");
}

/**
 * Whitespace-insensitive, so a block the formatter re-wrapped still reads as current, and a PNG
 * compared by what it shows, so a zlib that deflates the same pixels differently does too.
 */
const squash = (text) =>
  text
    .replace(/\s+/g, "")
    .replace(
      /data:image\/png;base64,([A-Za-z0-9+/=]+)/g,
      (_, data) => `png:${pngPixels(Buffer.from(data, "base64"))}`,
    );

const path = `${THEMES}${TARGET}`;
const text = readFileSync(path, "utf8");
const start = text.indexOf(`  ${BEGIN}`);
const end = text.indexOf(END);
if (start === -1 || end === -1)
  throw new Error(`${TARGET}: the generated block's markers are missing`);
const wanted = block();
if (squash(text.slice(start, end + END.length)) !== squash(wanted)) {
  if (process.argv.includes("--check")) {
    console.error(`stale: themes/${TARGET} — run node packages/ui/scripts/draw-doodle-hatches.mjs`);
    process.exit(1);
  }
  writeFileSync(path, text.slice(0, start) + wanted + text.slice(end + END.length));
}
