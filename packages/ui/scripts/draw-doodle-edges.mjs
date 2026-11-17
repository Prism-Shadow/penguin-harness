/**
 * Draws the Doodle pack's pen lines and writes them, as the custom properties its recipes read,
 * into the generated block of `src/themes/doodle/recipes.css`.
 *
 *   node packages/ui/scripts/draw-doodle-edges.mjs          rewrite the block
 *   node packages/ui/scripts/draw-doodle-edges.mjs --check  exit 1 if the block is stale
 *
 * The line. Each shape is one rounded rectangle traced by a felt tip from a fixed seed: the
 * straight runs wander most of a pixel off true, every corner is a slightly uneven arc, and the
 * pen starts a hair inside the box on the top-left and runs out onto the line, the start overlap
 * of a drawn loop. A redraw prints the same bytes, so the recipes change only when a parameter
 * here does. From that one list of points come:
 *
 * - `--_stroke-<shape>[-<ink>]`: the pen line alone, laid on a box as a `border-image` 9-slice —
 *   the corners keep their drawn shape and the runs between them stretch along the box. A shape a
 *   page shows by the dozen (a field, the person's bubble, a capsule) is a bitmap — a PNG at twice
 *   its size in an `image-set`, rendered from the points by `raster-strokes.mjs` — because a
 *   9-slice of an SVG is re-rasterised for every slice of every box on every repaint and a
 *   bitmap's is copied; the rarer shapes stay SVG, which is smaller.
 * - `--_clip-<shape>`: the same outline as a `clip-path: shape()` (the shapes whose corners are
 *   laid at a fixed size: the field, the bubble, the box and the navigation's primary action),
 *   pushed outward by half the pen plus a quarter pixel so the line's outer half is never cut.
 *   Every point is placed where the 9-slice stretch puts it — a corner's points in fixed px from
 *   their edge, a run's in a percentage plus a px term — so the box's own background ends under
 *   the line at every size, and a resize stretches the shape as it stretches the stroke: nothing
 *   re-wobbles. A capsule has no clip: its corners are laid at half the host's height, whatever
 *   that is, and the host's own full radius ends its fill under the line.
 * - `--_glass-<shape>[-focus]`: the outline filled with the overlay, the line on it and a soft
 *   shadow drawn under it in a 12 px margin, for what floats (a dialog, a menu, a tooltip, the
 *   composer, a toast). It is applied with `border-image … fill` and a 12 px outset, so the slip
 *   needs no fill, shadow or filter of its own and the shadow follows the drawn shape.
 * - `--_swipe`: one pass of a highlighter, a filled band with uneven edges and slanted ends, laid
 *   under the navigation's current row as a 3-slice (its ends keep their shape, the band between
 *   them stretches).
 * - `--_cut-cookie`: a piece of cut paper in the highlighter, laid on the desk pad as a background
 *   image; `--_clip-cookie` and `--_clip-clover`, two of Material 3 Expressive's shapes as
 *   `clip-path: polygon()` for an avatar and a tile.
 *
 * Shapes, as `image px / corner radius / slice`: `control` 28 / 5 / 9 (what a person types into),
 * `bubble` 48 / 16·16·4·16 / 18 (the person's own words: three round corners and the one nearest
 * the sender tight), `pill` 52 / 18 / 20 (what a person presses: a capsule at any height),
 * `bead` 30 / 9 / 11 (a small round host: a switch's track, a radio's disc), `box` 18 / 3 / 6 (a
 * checkbox), `fab` 48 / 13 / 17 (the navigation's primary action). The slips: `label` 28 / 5 / 9
 * (a tooltip, a caption), `slip` 52 / 12 / 16 (a menu, a popover, a toast) and `sheet`
 * 68 / 22 / 26 (a dialog, the composer). Inks: the line ink (the chalk in dark), `-danger` (a
 * field that failed, a destructive button) and `-focus` (the ballpoint blue of the focus ring: a
 * focused field, the focused composer).
 *
 * An image cannot read a custom property, so the inks, the overlay and the highlighter are
 * spelled here: the pack's line ink, danger ink, focus blue, overlay and highlighter. Change them
 * together with `themes/doodle/tokens.css`.
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
const OVERLAY = { light: "#fffefb", dark: "#25221f" };

/** The shadow under a slip: a contact shadow a pixel down and a far one a few pixels down. */
const SHADOW = {
  light: { color: "#3a2c1e", contact: 0.2, far: 0.032 },
  dark: { color: "#000000", contact: 0.5, far: 0.07 },
};

/** The margin a glass image keeps round its outline for the shadow; the recipes' outset. */
const MARGIN = 12;

/** The highlighter a swipe is drawn in: yellow on paper, a dim amber on dark paper. */
const HIGHLIGHT = { light: "#ffe27a", dark: "#5e5013" };

/**
 * `size` is the square image, `slice` the corner region the recipes cut it at, `radius` the
 * corner's arc — one number, or four (top-left, top-right, bottom-right, bottom-left). `bitmap`
 * marks the shapes a page shows by the dozen, whose stroke ships as a PNG; the rest stay SVG,
 * which is smaller and costs nothing at the few a page shows. `arcSteps` is how many chords draw
 * a quarter arc. `tail` draws the pen's start overlap (only where it stays inside the corner
 * region, which never stretches). `clip` marks the shapes laid at a fixed corner size, whose
 * outline is also a `clip-path`; a capsule (`pill`, `bead`) is laid with a `border-image-width`
 * past any box, which the browser scales down until the corners meet — half the host's height —
 * so its line thickens with the host and no fixed clip could follow it. `wander` is how far the
 * pen strays where the shape's own is not the pack's: a capsule is scaled with its host, so its
 * arcs are drawn with more chords and less play.
 */
const SHAPES = {
  control: {
    size: 28,
    slice: 9,
    radius: 5,
    stroke: 1.9,
    seed: 5,
    tail: true,
    bitmap: true,
    clip: true,
  },
  bubble: {
    size: 48,
    slice: 18,
    radius: [16, 16, 4, 16],
    stroke: 2,
    seed: 11,
    tail: true,
    bitmap: true,
    clip: true,
  },
  pill: {
    size: 52,
    slice: 20,
    radius: 18,
    stroke: 2,
    seed: 17,
    arcSteps: 8,
    wander: { run: 0.6, arc: 0.4 },
    bitmap: true,
  },
  bead: {
    size: 30,
    slice: 11,
    radius: 9,
    stroke: 1.8,
    seed: 29,
    arcSteps: 6,
    wander: { run: 0.5, arc: 0.3 },
    bitmap: true,
  },
  box: { size: 18, slice: 6, radius: 3, stroke: 1.7, seed: 23, clip: true },
  fab: { size: 48, slice: 17, radius: 13, stroke: 2.2, seed: 37, tail: true, clip: true },
};

/** The slips of what floats: the outline, its fill and its shadow in one image. */
const SLIPS = {
  label: { size: 28, slice: 9, radius: 5, stroke: 1.9, seed: 5, tail: true },
  slip: { size: 52, slice: 16, radius: 12, stroke: 2, seed: 41, tail: true },
  sheet: { size: 68, slice: 26, radius: 22, stroke: 2.1, seed: 43, arcSteps: 5, tail: true },
};

/**
 * How far inside its image the line's centre runs, and how far the pen wanders off true: a felt
 * tip, not a fineliner. Half the widest pen plus the wander stays inside the inset, so the image's
 * edge never shaves the line flat.
 */
const INSET = 2;
const WANDER = { run: 0.8, arc: 0.7 };

/** A small linear congruential generator: the same seed, the same line. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A shape's four corner radii: top-left, top-right, bottom-right, bottom-left. */
const corners = ({ radius }) => (Array.isArray(radius) ? radius : [radius, radius, radius, radius]);

/**
 * The outline's points, `off` px outside the drawn line (0 for the line itself). The jitter
 * comes from the shape's seed in a fixed order, so the line and its offset copy wander together:
 * a run moves along its normal, an arc keeps its centre and grows by `off`.
 */
function outline(shape, off = 0) {
  const { size, seed, arcSteps = 3, wander = WANDER } = shape;
  const [tl, tr, br, bl] = corners(shape);
  const next = random(seed);
  const jitter = (amount) => (next() * 2 - 1) * amount;
  const lo = INSET;
  const hi = size - INSET;
  const points = [];
  // A straight run, from one corner's arc to the next, wandering most of a pixel off true. A run
  // too short to wander is one point, so nothing zigzags where a slice stretches.
  const run = (x0, y0, x1, y1) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < 1) return;
    const steps = length >= 6 ? 5 : 1;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      points.push([
        x0 + (x1 - x0) * t + jitter(wander.run),
        y0 + (y1 - y0) * t + jitter(wander.run),
      ]);
    }
  };
  // A quarter arc whose radius wavers (a tight corner by less), from chord `from` to chord `to`.
  const arc = (cx, cy, start, radius, from = 0, to = arcSteps) => {
    for (let k = from; k <= to; k++) {
      const angle = start + (k / arcSteps) * (Math.PI / 2);
      const r = radius + off + jitter(Math.min(wander.arc, radius / 6));
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  };
  points.top = 0;
  run(lo + tl, lo - off, hi - tr, lo - off);
  arc(hi - tr, lo + tr, -Math.PI / 2, tr);
  run(hi + off, lo + tr, hi + off, hi - br);
  arc(hi - br, hi - br, 0, br);
  run(hi - br, hi + off, lo + bl, hi + off);
  arc(lo + bl, hi - bl, Math.PI / 2, bl);
  run(lo - off, hi - bl, lo - off, lo + tl);
  arc(lo + tl, lo + tl, Math.PI, tl);
  return points;
}

/** A clip's coordinates keep two decimals; a drawn path one, a twentieth of a pixel at most. */
const f = (v) => Number(v.toFixed(2));
const d1 = (v) => Number(v.toFixed(1));
const polyline = (pts) => `M${pts.map(([x, y]) => `${d1(x)} ${d1(y)}`).join("L")}`;

/**
 * The pen's start overlap: from a hair inside the top-left corner out onto the top line, ending
 * where the line starts and inside the corner region, so its outer edge is the line's, the clip
 * never cuts it and a stretched run never drags it out.
 */
function tail(points, shape) {
  const [x0, y0] = points[points.top];
  const end = Math.min(x0 + 2.2, shape.slice - 0.4);
  return [
    [end - 5.5, y0 + 1.8],
    [end, y0 - 0.1],
  ];
}

/** The line as one path: the closed loop and, where drawn, the start overlap. */
function linePath(shape) {
  const points = outline(shape);
  return {
    loop: `${polyline(points)}Z`,
    tail: shape.tail ? polyline(tail(points, shape)) : "",
  };
}

/** The same line as polylines, for the rasteriser: the loop, and the start overlap. */
function lineLines(shape) {
  const points = outline(shape);
  return [
    { points, closed: true },
    ...(shape.tail ? [{ points: tail(points, shape), closed: false }] : []),
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
    `<rect x='${INSET}' y='${INSET + y}' width='${size - 2 * INSET}' ` +
    `height='${size - 2 * INSET}' rx='${radius}' stroke-width='${width}'/>`;
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
function coord(v, { size, slice }) {
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

/**
 * One pass of a highlighter: a filled band, its long edges uneven and its ends slanted, the
 * corners rounded by a stroke of the same colour. 60 × 32, cut 14 px in from each end, so the
 * ends keep their shape and the band between them stretches along the row.
 */
function swipe(color) {
  const band =
    "M6.5 6L14 4.3L30 5.1L46 3.9L55 5.3L57.4 9L56.6 20L57.7 25.4L54 27.7L46 27L30 28.1L14 27.2" +
    "L5 27.9L2.5 24.4L3.4 13L2.6 8.6Z";
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='60' height='32' preserveAspectRatio='none'>` +
    `<path d='${band}' fill='${color}' stroke='${color}' stroke-width='3' ` +
    `stroke-linejoin='round'/></svg>`
  );
}

/**
 * Two shapes from Material 3 Expressive's library, as `clip-path: polygon()` in percentages, so
 * each fits a square host of any size. The cookie is the nine-sided one (a nine-pointed star,
 * inner radius 0.8, rounded until its points and its notches are one wave), a lobe at the top;
 * the clover is the four-leaf one: four discs on the diagonals, meeting in sharp notches on the
 * axes 85 % of the way out.
 */
const polygon = (points) => `polygon(${points.map(([x, y]) => `${f(x)}% ${f(y)}%`).join(", ")})`;

function cookiePoints(sides, depth = 0.1, steps = 8) {
  const points = [];
  for (let i = 0; i < sides * steps; i++) {
    const turn = (i / (sides * steps)) * 2 * Math.PI;
    const r = 1 - depth * (1 - Math.cos(sides * turn));
    const angle = turn - Math.PI / 2;
    points.push([50 + 50 * r * Math.cos(angle), 50 + 50 * r * Math.sin(angle)]);
  }
  return points;
}

const cookie = () => polygon(cookiePoints(9));

/**
 * A piece of cut paper for the desk pad: the twelve-sided cookie in the highlighter, flat, laid
 * as a background (Material 3 Expressive's large tonal shapes). 100 × 100, scaled by the recipe.
 */
function cutPaper(color, opacity) {
  return svg(
    100,
    `<path d='${polyline(cookiePoints(12, 0.07, 6))}Z' fill='${color}' fill-opacity='${opacity}'/>`,
  );
}

function clover(notch = 42.6, steps = 14) {
  // A leaf's disc touches two sides of the box and passes through the notches beside it, which
  // puts its centre `offset` in from the box's centre along each axis.
  const slack = 100 - 2 * notch;
  const offset = (-slack + Math.sqrt(slack * slack + 4 * (2500 - notch * notch))) / 2;
  const radius = 50 - offset;
  const points = [];
  for (let leaf = 0; leaf < 4; leaf++) {
    const turn = (leaf * Math.PI) / 2;
    const cx = 50 + offset * Math.SQRT2 * Math.cos(turn - Math.PI / 4);
    const cy = 50 + offset * Math.SQRT2 * Math.sin(turn - Math.PI / 4);
    // From the notch before the leaf (on the axis a quarter turn back) round to the one after.
    const start = Math.atan2(
      50 + notch * Math.sin(turn - Math.PI / 2) - cy,
      50 + notch * Math.cos(turn - Math.PI / 2) - cx,
    );
    let end = Math.atan2(50 + notch * Math.sin(turn) - cy, 50 + notch * Math.cos(turn) - cx);
    while (end <= start) end += 2 * Math.PI;
    for (let i = 0; i < steps; i++) {
      const angle = start + ((end - start) * i) / steps;
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  }
  return polygon(points);
}

/** The custom properties for one mode: strokes, slips and the swipe in its inks; the clips (light only, shared). */
function properties(mode) {
  const ink = (name) => INK[name][mode];
  const { control, bubble, pill, bead, box, fab } = SHAPES;
  const props = [
    ["--_stroke-control", stroke(control, ink("ink"))],
    ["--_stroke-control-danger", stroke(control, ink("danger"))],
    ["--_stroke-control-focus", stroke(control, ink("blue"))],
    ["--_stroke-bubble", stroke(bubble, ink("ink"))],
    ["--_stroke-pill", stroke(pill, ink("ink"))],
    ["--_stroke-pill-danger", stroke(pill, ink("danger"))],
    ["--_stroke-bead", stroke(bead, ink("ink"))],
    ["--_stroke-box", stroke(box, ink("ink"))],
    ["--_stroke-fab", stroke(fab, ink("ink"))],
    ["--_glass-label", url(glass(SLIPS.label, ink("ink"), mode))],
    ["--_glass-slip", url(glass(SLIPS.slip, ink("ink"), mode))],
    ["--_glass-sheet", url(glass(SLIPS.sheet, ink("ink"), mode))],
    ["--_glass-sheet-focus", url(glass(SLIPS.sheet, ink("blue"), mode))],
    ["--_swipe", url(swipe(HIGHLIGHT[mode]))],
    ["--_cut-cookie", url(cutPaper(HIGHLIGHT[mode], mode === "light" ? 0.62 : 0.55))],
  ];
  if (mode === "light") {
    for (const [name, shape] of Object.entries(SHAPES)) {
      if (shape.clip) props.push([`--_clip-${name}`, clip(shape)]);
    }
    props.push(["--_clip-cookie", cookie()], ["--_clip-clover", clover()]);
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
