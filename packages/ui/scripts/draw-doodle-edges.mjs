/**
 * Draws the Doodle pack's pen lines and writes them, as the custom properties its recipes read,
 * into the generated block of `src/themes/doodle/recipes.css`.
 *
 *   node packages/ui/scripts/draw-doodle-edges.mjs          rewrite the block
 *   node packages/ui/scripts/draw-doodle-edges.mjs --check  exit 1 if the block is stale
 *
 * The line. Each shape is one rounded rectangle traced by a pen from a fixed seed: the straight
 * runs wander a fraction of a pixel off true, every corner is a slightly uneven arc, and the pen
 * starts a hair inside the box on the top-left and runs out onto the line, the start overlap of a
 * drawn loop. A redraw prints the same bytes, so the recipes change only when a parameter here
 * does. From that one list of points come:
 *
 * - `--_stroke-<shape>[-<ink>]`: the pen line alone, laid on a box as a `border-image` 9-slice —
 *   the corners keep their drawn shape and the runs between them stretch along the box. A shape a
 *   page shows by the dozen (a control, the person's bubble, a pill) is a bitmap — a PNG at twice
 *   its size in an `image-set`, rendered from the points by `raster-strokes.mjs` — because a
 *   9-slice of an SVG is re-rasterised for every slice of every box on every repaint and a
 *   bitmap's is copied; the rarer shapes stay SVG, which is smaller.
 * - `--_clip-<shape>`: the same outline as a `clip-path: shape()` (every shape but the ball, which
 *   is laid over a round fill and holds a caption outside itself), pushed outward by half the pen
 *   plus a quarter pixel so the line's outer half is never cut. Every point is placed where the
 *   9-slice stretch puts it — a corner's points in fixed px from their edge, a run's in a
 *   percentage plus a px term — so the box's own background ends under the line at every size,
 *   and a resize stretches the shape as it stretches the stroke: nothing re-wobbles.
 * - `--_glass-<shape>[-focus]`: the outline filled with the overlay, the line on it and a soft
 *   shadow drawn under it in a 12 px margin, for what floats (a dialog, a menu, a tooltip, the
 *   composer, a toast). It is applied with `border-image … fill` and a 12 px outset, so the slip
 *   needs no fill, shadow or filter of its own and the shadow follows the drawn shape.
 *
 * Shapes, as `image px / corner radius / slice`: `control` 28 / 5 / 9 (what a person presses or
 * types into), `surface` 48 / 7 / 14 (the person's own bubble, and the slip of what floats),
 * `pill` 20 / 8 / 9 (a capsule; on a small square host laid at `50%` a corner, a disc,
 * `--_clip-disc`), `box` 18 / 3 / 6 (a checkbox), `ball` 48 / 23 / 24 (a large round host, laid
 * at `50%` a corner). Inks: the line ink (the chalk in dark), `-danger` (a field that failed) and
 * `-focus` (the ballpoint blue of the focus ring: a focused field, the focused composer).
 *
 * An image cannot read a custom property, so the inks and the overlay are spelled here: the
 * pack's line ink, danger ink, focus blue and overlay. Change them together with
 * `themes/doodle/tokens.css`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng, pngPixels, rasterize } from "./raster-strokes.mjs";

const RECIPES = fileURLToPath(new URL("../src/themes/doodle/recipes.css", import.meta.url));
const ROOT = ':root[data-theme="doodle"]';

/** Inks, per mode: the line ink (`--ui-fg`'s pen), danger, the focus ring's ballpoint blue. */
const INK = {
  ink: { light: "#352e29", dark: "#d9d1c1" },
  danger: { light: "#b3261e", dark: "#ff8f7f" },
  blue: { light: "#2c4f9e", dark: "#93b6ee" },
};

/** The fill a floating slip is painted in: `--ui-overlay`. */
const OVERLAY = { light: "#fdfbf6", dark: "#25221f" };

/** The shadow under a slip: a contact shadow a pixel down and a far one a few pixels down. */
const SHADOW = {
  light: { color: "#3a2c1e", contact: 0.2, far: 0.032 },
  dark: { color: "#000000", contact: 0.5, far: 0.07 },
};

/** The margin a glass image keeps round its outline for the shadow; the recipes' outset. */
const MARGIN = 12;

/**
 * `size` is the square image, `slice` the corner region the recipes cut it at, `radius` the
 * corner's arc. `bitmap` marks the shapes a page shows by the dozen, whose stroke ships as a PNG;
 * the rest stay SVG, which is smaller and costs nothing at the few a page shows. `arcSteps` is how
 * many chords draw a quarter arc. `tail` draws the pen's start overlap (only where it stays
 * inside the corner region, which never stretches). `scale: "half"` maps the image onto a square
 * host at 50 % per corner (`border-image-width: 50%`), so the shape is a circle at any size.
 */
const SHAPES = {
  control: { size: 28, slice: 9, radius: 5, stroke: 1.45, seed: 5, tail: true, bitmap: true },
  surface: { size: 48, slice: 14, radius: 7, stroke: 1.55, seed: 11, tail: true, bitmap: true },
  pill: { size: 20, slice: 9, radius: 8, stroke: 1.45, seed: 17, arcSteps: 6, bitmap: true },
  box: { size: 18, slice: 6, radius: 3, stroke: 1.45, seed: 23 },
  ball: { size: 48, slice: 24, radius: 23, stroke: 1.55, seed: 31, arcSteps: 6, scale: "half" },
};

/** A small linear congruential generator: the same seed, the same line. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * The outline's points, `off` px outside the drawn line (0 for the line itself). The jitter
 * comes from the shape's seed in a fixed order, so the line and its offset copy wander together:
 * a run moves along its normal, an arc keeps its centre and grows by `off`.
 */
function outline(shape, off = 0) {
  const { size, radius, seed, arcSteps = 3 } = shape;
  const next = random(seed);
  const jitter = (amount) => (next() * 2 - 1) * amount;
  const lo = 1;
  const hi = size - 1;
  const points = [];
  // A straight run, from one corner's arc to the next, wandering up to 0.45px off true. A run too
  // short to wander (a pill's) is one point, so nothing zigzags where a slice stretches.
  const run = (x0, y0, x1, y1) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < 1) return;
    const steps = length >= 6 ? 5 : 1;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      points.push([x0 + (x1 - x0) * t + jitter(0.45), y0 + (y1 - y0) * t + jitter(0.45)]);
    }
  };
  // A quarter arc whose radius wavers by up to half a pixel, from chord `from` to chord `to`.
  const arc = (cx, cy, start, from = 0, to = arcSteps) => {
    for (let k = from; k <= to; k++) {
      const angle = start + (k / arcSteps) * (Math.PI / 2);
      const r = radius + off + jitter(0.5);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  };
  // With no runs at all (a ball) the four arcs meet end to end: each arc after the first leaves
  // out the point the last one ended on, and the loop closes onto the first arc's first point.
  const round = hi - lo - 2 * radius < 1 ? 1 : 0;
  points.top = 0;
  run(lo + radius, lo - off, hi - radius, lo - off);
  arc(hi - radius, lo + radius, -Math.PI / 2);
  run(hi + off, lo + radius, hi + off, hi - radius);
  arc(hi - radius, hi - radius, 0, round);
  run(hi - radius, hi + off, lo + radius, hi + off);
  arc(lo + radius, hi - radius, Math.PI / 2, round);
  run(lo - off, hi - radius, lo - off, lo + radius);
  arc(lo + radius, lo + radius, Math.PI, round, arcSteps - round);
  return points;
}

/** A clip's coordinates keep two decimals; a drawn path one, a twentieth of a pixel at most. */
const f = (v) => Number(v.toFixed(2));
const d1 = (v) => Number(v.toFixed(1));
const polyline = (pts) => `M${pts.map(([x, y]) => `${d1(x)} ${d1(y)}`).join("L")}`;

/**
 * The pen's start overlap: from a hair inside the top-left corner out onto the top line, ending
 * where the line starts, so its outer edge is the line's and the clip never cuts it.
 */
function tail(points) {
  const [x0, y0] = points[points.top];
  return [
    [x0 - 3, y0 + 1.8],
    [x0 + 2.5, y0 - 0.1],
  ];
}

/** The line as one path: the closed loop and, where drawn, the start overlap. */
function linePath(shape) {
  const points = outline(shape);
  return { loop: `${polyline(points)}Z`, tail: shape.tail ? polyline(tail(points)) : "" };
}

/** The same line as polylines, for the rasteriser: the loop, and the start overlap. */
function lineLines(shape) {
  const points = outline(shape);
  return [
    { points, closed: true },
    ...(shape.tail ? [{ points: tail(points), closed: false }] : []),
  ];
}

const svg = (size, inner) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${inner}</svg>`;

/**
 * The pen line alone. A shape shown by the dozen is a bitmap a 9-slice copies rather than redraws:
 * one PNG at twice its size, which `image-set` lays at its own size (a 1x screen scales it down).
 * A rarely shown shape stays SVG.
 */
function stroke(shape, ink) {
  const lines = lineLines(shape);
  if (shape.bitmap) {
    const data = encodePng(
      rasterize({ size: shape.size, scale: 2, width: shape.stroke, lines }),
      ink,
    );
    return `image-set(url("data:image/png;base64,${data.toString("base64")}") 2x)`;
  }
  const d = lines.map(({ points, closed }) => polyline(points) + (closed ? "Z" : "")).join("");
  return url(
    svg(
      shape.size,
      `<path d='${d}' fill='none' stroke='${ink}' stroke-width='${shape.stroke}' ` +
        `stroke-linecap='round' stroke-linejoin='round'/>`,
    ),
  );
}

/**
 * The outline filled and lined, over a soft shadow drawn as widening strokes at a low alpha: one
 * rounded box under the outline, stroked once a pixel down for the contact shadow and five times,
 * widening, four pixels down for the far one. Each ring is its own `<rect>` (no `<use>`), so the
 * image refers to nothing, inside it or out.
 */
function glass(shape, ink, mode) {
  const { size, radius } = shape;
  const { color, contact, far } = SHADOW[mode];
  const ring = (y, width) =>
    `<rect x='1' y='${1 + y}' width='${size - 2}' height='${size - 2}' rx='${radius}' ` +
    `stroke-width='${width}'/>`;
  const shadow =
    `<g fill='none' stroke='${color}'><g stroke-opacity='${contact}'>${ring(1, 1.5)}</g>` +
    `<g stroke-opacity='${far}'>${[3, 5.5, 8, 10.5, 13].map((w) => ring(4, w)).join("")}</g></g>`;
  const { loop, tail: t } = linePath(shape);
  const line =
    `<path d='${loop}' fill='${OVERLAY[mode]}' stroke='${ink}' stroke-width='${shape.stroke}' ` +
    `stroke-linejoin='round'/>` +
    (t === ""
      ? ""
      : `<path d='${t}' fill='none' stroke='${ink}' stroke-width='${shape.stroke}' stroke-linecap='round'/>`);
  return svg(
    size + 2 * MARGIN,
    `<g transform='translate(${MARGIN} ${MARGIN})'>${shadow}${line}</g>`,
  );
}

/** Where the 9-slice stretch puts an image coordinate `v`, as a CSS length (see the header). */
function coord(v, { size, slice, scale }) {
  if (scale === "half") {
    if (v <= slice) return `${f((v / slice) * 50)}%`;
    if (v >= size - slice) return `${f(50 + ((v - (size - slice)) / slice) * 50)}%`;
    return "50%";
  }
  if (v <= slice) return `${f(v)}px`;
  if (v >= size - slice) {
    const d = f(size - v);
    return d === 0 ? "100%" : `calc(100% ${d < 0 ? "+" : "-"} ${Math.abs(d)}px)`;
  }
  const t = (v - slice) / (size - 2 * slice);
  const px = f(slice * (1 - 2 * t));
  return `calc(${f(t * 100)}% ${px < 0 ? "-" : "+"} ${Math.abs(px)}px)`;
}

/** The clip: the outline pushed out by half the pen and a quarter pixel, mapped through the stretch. */
function clip(shape) {
  const points = outline(shape, shape.stroke / 2 + 0.25);
  const [first, ...rest] = points.map(([x, y]) => `${coord(x, shape)} ${coord(y, shape)}`);
  return `shape(from ${first}, ${rest.map((p) => `line to ${p}`).join(", ")}, close)`;
}

/** Percent-encodes only what a CSS `url("…")` holding SVG needs encoded. */
const encode = (text) =>
  text.replace(/[<>#%"{}|\\^`\n]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const url = (text) => `url("data:image/svg+xml,${encode(text)}")`;

/** The custom properties for one mode: strokes and glass in its inks; the clips (light only, shared). */
function properties(mode) {
  const ink = (name) => INK[name][mode];
  const { control, surface, pill, box, ball } = SHAPES;
  const props = [
    ["--_stroke-control", stroke(control, ink("ink"))],
    ["--_stroke-control-danger", stroke(control, ink("danger"))],
    ["--_stroke-control-focus", stroke(control, ink("blue"))],
    ["--_stroke-surface", stroke(surface, ink("ink"))],
    ["--_stroke-pill", stroke(pill, ink("ink"))],
    ["--_stroke-box", stroke(box, ink("ink"))],
    ["--_stroke-ball", stroke(ball, ink("ink"))],
    ["--_glass-control", url(glass(control, ink("ink"), mode))],
    ["--_glass-surface", url(glass(surface, ink("ink"), mode))],
    ["--_glass-surface-focus", url(glass(surface, ink("blue"), mode))],
  ];
  if (mode === "light") {
    // The ball is laid unclipped over a round fill (it holds a caption outside itself).
    for (const [name, shape] of Object.entries(SHAPES)) {
      if (name !== "ball") props.push([`--_clip-${name}`, clip(shape)]);
    }
    // A pill's drawing on a small square host (a radio's disc): its corners at 50 % each.
    props.push(["--_clip-disc", clip({ ...pill, scale: "half" })]);
  }
  return props;
}

const BEGIN = "/* draw-doodle-edges.mjs: begin generated block, do not edit by hand */";
const END = "/* draw-doodle-edges.mjs: end generated block */";

function block() {
  const rule = (selector, props) =>
    `${selector} {\n${props.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}`;
  return [
    BEGIN,
    rule(ROOT, properties("light")),
    rule(`${ROOT}.dark`, properties("dark")),
    END,
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

const text = readFileSync(RECIPES, "utf8");
const start = text.indexOf(BEGIN);
const end = text.indexOf(END);
if (start === -1 || end === -1)
  throw new Error("recipes.css: the generated block's markers are missing");
const wanted = block();
if (squash(text.slice(start, end + END.length)) !== squash(wanted)) {
  if (process.argv.includes("--check")) {
    console.error(
      "stale: themes/doodle/recipes.css — run node packages/ui/scripts/draw-doodle-edges.mjs",
    );
    process.exit(1);
  }
  writeFileSync(RECIPES, text.slice(0, start) + wanted + text.slice(end + END.length));
}
