/**
 * Draws the Doodle theme's pen lines and paper marks and writes them, as the custom properties
 * the theme's recipes read, into the generated blocks of `src/themes/cartoon/line.css` and
 * `src/themes/cartoon/marks.css`.
 *
 *   node packages/ui/scripts/draw-doodle-edges.mjs          rewrite both blocks
 *   node packages/ui/scripts/draw-doodle-edges.mjs --check  exit 1 if either block is stale
 *   node packages/ui/scripts/draw-doodle-edges.mjs --geometry  the surface line and fill corner, JSON
 *
 * The line. Each shape is one rounded rectangle traced by a pen from a fixed seed: the straight
 * runs wander a fraction of a pixel off true, every corner is a slightly uneven arc, and the pen
 * starts a hair inside the box on the top-left and runs out onto the line, the start overlap of a
 * drawn loop. A redraw prints the same bytes, so the theme file changes only when a parameter here
 * does. From that one list of points come:
 *
 * - `--_stroke-<shape>[-<ink>]`: the pen line alone, laid on a box as a `border-image` 9-slice —
 *   the corners keep their drawn shape and the runs between them stretch along the box. A shape
 *   a page shows by the dozen (a control, a surface, a pill) is a bitmap — a PNG at twice its size
 *   in an `image-set`, rendered from the points by `raster-strokes.mjs` — because a 9-slice of an
 *   SVG is re-rasterised for every slice of every box on every repaint and a bitmap's is copied;
 *   the rarer shapes and the dashed lines stay SVG, which is smaller.
 * - `--_fill-radius-surface`: the CSS corner a frame's padding-box fill takes instead of a clip —
 *   the radius whose corner stays nearest the drawn line at its worst, within the pen's half-width
 *   at every corner, so a frame's fill ends under the line without the clip a tall box with a lot
 *   inside it pays for on every repaint.
 * - `--_clip-<shape>`: the same outline as a `clip-path: shape()`, pushed outward by half the pen
 *   plus a quarter pixel so the line's outer half is never cut. Every point is placed where the
 *   9-slice stretch puts it — a corner's points in fixed px from their edge, a run's in a percentage
 *   plus a px term — so the box's own background ends under the line at every size, and a resize
 *   stretches the shape as it stretches the stroke: nothing re-wobbles.
 * - `--_glass-<shape>[-<fill>]`: the outline filled, the line on it and a soft shadow drawn under
 *   it in a 12 px margin, for what floats (a dialog, a menu, a tooltip, the composer, a toast). It
 *   is applied with `border-image … fill` and a 12 px outset, so the surface needs no fill, shadow
 *   or filter of its own and the shadow follows the drawn shape.
 *
 * An image cannot read a custom property, so the inks and fills are spelled here: the theme's
 * line ink (the chalk in dark), the danger ink, the ballpoint blue of the focus ring and the
 * person's own words, a pencil for dashed placeholders, the overlay slip and the five tones'
 * washes. Change them together with `themes/cartoon.css`.
 *
 * The marks — a highlighter band, a blue pencil bracket and a pencil rule each way — are drawn
 * here too, for the section recipes to place.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng, pngPixels, rasterize } from "./raster-strokes.mjs";

const THEMES = fileURLToPath(new URL("../src/themes/cartoon/", import.meta.url));
const MODES = ["light", "dark"];

/** Inks, per mode: the theme's line ink (`--ui-fg`'s pen), danger, ballpoint blue, a pencil. */
const INK = {
  ink: { light: "#352e29", dark: "#d9d1c1" },
  danger: { light: "#b3261e", dark: "#ff8f7f" },
  blue: { light: "#2c4f9e", dark: "#93b6ee" },
  pencil: { light: "#8f8576", dark: "#8a8174" },
};

/** Fills a floating slip is painted in: the overlay, and each notice tone's wash. */
const FILL = {
  overlay: { light: "#fdfbf6", dark: "#25221f" },
  info: { light: "#e0eaf4", dark: "#232e3b" },
  success: { light: "#e2eddb", dark: "#26332a" },
  warning: { light: "#f6eac6", dark: "#3a3020" },
  danger: { light: "#f7e1db", dark: "#3d2623" },
  neutral: { light: "#ebe4d6", dark: "#34302b" },
};

/** The shadow under a slip: a contact shadow a pixel down and a far one a few pixels down. */
const SHADOW = {
  light: { color: "#3a2c1e", contact: 0.2, far: 0.032 },
  dark: { color: "#000000", contact: 0.5, far: 0.07 },
};

/** The margin a glass image keeps round its outline for the shadow; the theme's outset. */
const MARGIN = 12;

/**
 * `size` is the square image, `slice` the corner region the theme cuts it at, `radius` the
 * corner's arc. `bitmap` marks the shapes a page shows by the dozen (a box of every kind, a badge),
 * whose stroke ships as a PNG; the rest stay SVG, which is smaller and costs nothing at the few a
 * page shows. `arcSteps` is how many chords draw a quarter arc. `tail` draws the pen's start
 * overlap (only where it stays inside the corner region, which never stretches). `open` leaves
 * the bottom edge undrawn (a folder or notebook tab). `scale: "half"` maps the image onto a
 * square host at 50 % per corner (`border-image-width: 50%`), so the shape is a circle at any size.
 */
const SHAPES = {
  control: { size: 28, slice: 9, radius: 5, stroke: 1.45, seed: 5, tail: true, bitmap: true },
  surface: { size: 48, slice: 14, radius: 7, stroke: 1.55, seed: 11, tail: true, bitmap: true },
  pill: { size: 20, slice: 9, radius: 8, stroke: 1.45, seed: 17, arcSteps: 6, bitmap: true },
  box: { size: 18, slice: 6, radius: 3, stroke: 1.45, seed: 23 },
  tab: { size: 28, slice: 9, radius: 5, stroke: 1.45, seed: 29, tail: true, open: true },
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
  const { size, radius, seed, arcSteps = 3, open = false } = shape;
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
  if (open) {
    // Up the left side from the bottom edge, over the top, down the right side to the bottom edge.
    points.push([lo - off, size]);
    run(lo - off, size - 2, lo - off, lo + radius);
    arc(lo + radius, lo + radius, Math.PI);
    points.top = points.length;
    run(lo + radius, lo - off, hi - radius, lo - off);
    arc(hi - radius, lo + radius, -Math.PI / 2);
    run(hi + off, lo + radius, hi + off, size - 2);
    points.push([hi + off, size]);
    return points;
  }
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

/** The line as one path: the closed loop (open for a tab) and, where drawn, the start overlap. */
function linePath(shape) {
  const points = outline(shape);
  const loop = polyline(points) + (shape.open ? "" : "Z");
  return { loop, tail: shape.tail ? polyline(tail(points)) : "" };
}

/** The same line as polylines, for the rasteriser: the loop, and the start overlap. */
function lineLines(shape) {
  const points = outline(shape);
  return [
    { points, closed: !shape.open },
    ...(shape.tail ? [{ points: tail(points), closed: false }] : []),
  ];
}

/**
 * A dashed copy of the line in pencil, for a placeholder box. Each corner is a solid tick — its
 * arc and a little of each run — and each run between the corner regions is dashes on a 5 px
 * period that starts and ends on the slice, so the theme lays the image with
 * `border-image-repeat: round` and the dashes keep their length on a box of any size.
 */
function dashedPath(shape) {
  const { size, slice } = shape;
  const next = random(shape.seed + 1000);
  const wobble = () => (next() * 2 - 1) * 0.35;
  const lo = 1;
  const hi = size - 1;
  // The loop's arcs, each four points after a run of five: top-right, bottom-right, bottom-left,
  // top-left.
  const loop = outline(shape);
  const [tr, br, bl, tl] = [0, 1, 2, 3].map((i) => loop.slice(i * 9 + 5, i * 9 + 9));
  const near = slice - 1;
  const far = size - slice + 1;
  const ticks = [
    [[lo, near], ...tl, [near, lo]],
    [[far, lo], ...tr, [hi, near]],
    [[hi, far], ...br, [far, hi]],
    [[near, hi], ...bl, [lo, far]],
  ];
  const dashes = [];
  for (let start = slice + 1; start + 3 <= size - slice; start += 5) {
    const end = start + 3;
    dashes.push([
      [start, lo + wobble()],
      [end, lo + wobble()],
    ]);
    dashes.push([
      [hi + wobble(), start],
      [hi + wobble(), end],
    ]);
    dashes.push([
      [end, hi + wobble()],
      [start, hi + wobble()],
    ]);
    dashes.push([
      [lo + wobble(), end],
      [lo + wobble(), start],
    ]);
  }
  return [...ticks, ...dashes].map((points) => ({ points, closed: false }));
}

const svg = (size, inner) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${inner}</svg>`;

/**
 * The pen line alone. A shape shown by the dozen is a bitmap a 9-slice copies rather than redraws:
 * one PNG at twice its size, which `image-set` lays at its own size (a 1x screen scales it down).
 * A dashed line and a rarely shown shape stay SVG.
 */
function stroke(shape, ink, { dashed = false } = {}) {
  const width = dashed ? 1.2 : shape.stroke;
  const lines = dashed ? dashedPath(shape) : lineLines(shape);
  if (shape.bitmap && !dashed) {
    const data = encodePng(rasterize({ size: shape.size, scale: 2, width, lines }), ink);
    return `image-set(url("data:image/png;base64,${data.toString("base64")}") 2x)`;
  }
  const d = lines.map(({ points, closed }) => polyline(points) + (closed ? "Z" : "")).join("");
  return url(
    svg(
      shape.size,
      `<path d='${d}' fill='none' stroke='${ink}' stroke-width='${width}' ` +
        `stroke-linecap='round' stroke-linejoin='round'/>`,
    ),
  );
}

/** Distance from a point to the nearest segment of a polyline. */
function distanceTo([px, py], points, closed) {
  let best = Infinity;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(
      0,
      Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(px - x0 - t * dx, py - y0 - t * dy));
  }
  return best;
}

/**
 * The edge of a padding-box fill with a CSS corner `radius` under a 1px border, in a shape's image
 * coordinates: at each of the four corners its arc and its straight runs out to the slice, where
 * the 9-slice begins to stretch (a corner region keeps its size in every box, so this is the edge
 * in every box).
 */
function fillEdge({ size, slice }, radius) {
  const inner = Math.max(0, radius - 1);
  const quarter = [];
  for (let deg = 180; deg <= 270; deg += 2) {
    const a = (deg * Math.PI) / 180;
    quarter.push([radius + inner * Math.cos(a), radius + inner * Math.sin(a)]);
  }
  for (let v = radius; v <= slice; v += 0.5) quarter.push([1, v], [v, 1]);
  return [
    ...quarter,
    ...quarter.map(([x, y]) => [size - x, y]),
    ...quarter.map(([x, y]) => [size - x, size - y]),
    ...quarter.map(([x, y]) => [x, size - y]),
  ];
}

/**
 * The CSS corner a frame's fill takes in place of a clip: of the radii up to the slice, the one
 * whose fill edge strays least from the drawn line at its worst, so the fill ends under the pen
 * at every corner whatever way the line wobbles there. The line's own half-width is the limit; a
 * radius that cannot meet it stops the script.
 */
function fillRadius(shape) {
  const line = outline(shape);
  let best = { radius: 0, reach: Infinity };
  for (let radius = 1.5; radius <= shape.slice; radius += 0.05) {
    const reach = Math.max(...fillEdge(shape, radius).map((p) => distanceTo(p, line, true)));
    if (reach < best.reach) best = { radius: f(radius), reach };
  }
  if (best.reach > shape.stroke / 2) {
    throw new Error(`no fill corner stays under the ${shape.size}px line (best ${best.reach})`);
  }
  return best.radius;
}

/** The outline filled and lined, over a soft shadow drawn as widening strokes at a low alpha. */
function glass(shape, fill, ink, mode) {
  const { size, radius } = shape;
  const { color, contact, far } = SHADOW[mode];
  // One rounded box under the outline, stroked once a pixel down for the contact shadow and
  // five times, widening, four pixels down for the far one.
  const ring = (y, width) => `<use href='#s' y='${y}' stroke-width='${width}'/>`;
  const shadow =
    `<defs><rect id='s' x='1' y='1' width='${size - 2}' height='${size - 2}' rx='${radius}'/></defs>` +
    `<g fill='none' stroke='${color}'><g stroke-opacity='${contact}'>${ring(1, 1.5)}</g>` +
    `<g stroke-opacity='${far}'>${[3, 5.5, 8, 10.5, 13].map((w) => ring(4, w)).join("")}</g></g>`;
  const { loop, tail: t } = linePath(shape);
  const line =
    `<path d='${loop}' fill='${fill}' stroke='${ink}' stroke-width='${shape.stroke}' ` +
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

/** The line's custom properties for one mode: strokes (bitmaps) and glass (SVG); the clips (light only, shared). */
function lineProperties(mode) {
  const ink = (name) => INK[name][mode];
  const { control, surface, pill, box, tab, ball } = SHAPES;
  const props = [
    ["--_stroke-control", stroke(control, ink("ink"))],
    ["--_stroke-control-danger", stroke(control, ink("danger"))],
    ["--_stroke-control-focus", stroke(control, ink("blue"))],
    ["--_stroke-control-dashed", stroke(control, ink("pencil"), { dashed: true })],
    ["--_stroke-surface", stroke(surface, ink("ink"))],
    ["--_stroke-surface-you", stroke(surface, ink("blue"))],
    ["--_stroke-surface-dashed", stroke(surface, ink("pencil"), { dashed: true })],
    ["--_stroke-pill", stroke(pill, ink("ink"))],
    ["--_stroke-box", stroke(box, ink("ink"))],
    ["--_stroke-tab", stroke(tab, ink("ink"))],
    ["--_stroke-ball", stroke(ball, ink("ink"))],
    ["--_glass-control", url(glass(control, FILL.overlay[mode], ink("ink"), mode))],
    ["--_glass-surface", url(glass(surface, FILL.overlay[mode], ink("ink"), mode))],
    ["--_glass-surface-focus", url(glass(surface, FILL.overlay[mode], ink("blue"), mode))],
    ...["info", "success", "warning", "danger", "neutral"].map((tone) => [
      `--_glass-surface-${tone}`,
      url(glass(surface, FILL[tone][mode], ink("ink"), mode)),
    ]),
  ];
  if (mode === "light") {
    for (const [name, shape] of Object.entries(SHAPES))
      props.push([`--_clip-${name}`, clip(shape)]);
    // A frame's fill, which follows the line by its corner rather than a clip.
    props.push(["--_fill-radius-surface", `${fillRadius(surface)}px`]);
    // A pill's drawing on a small square host (a radio's disc): its corners at 50 % each.
    props.push(["--_clip-disc", clip({ ...pill, scale: "half" })]);
  }
  return props;
}

/** Pencil and highlighter inks for the marks, per mode. */
const MARK = {
  highlight: { light: ["#f2d34f", 0.5], dark: ["#f2d34f", 0.28] },
  bracket: { light: ["#2c4f9e", 0.85], dark: ["#93b6ee", 0.85] },
  rule: { light: ["#a69a87", 1], dark: ["#6a6257", 1] },
};

/**
 * The marks for one mode. The highlighter is a marker band 40 × 18 with ragged ends, sliced
 * `0 12` (its 16 px middle stretches); the bracket is a pencil `[` 8 × 24, sliced `8 0` (its
 * middle stretches); the rules are a pencil line wobbling over a 40 px tile that starts and ends
 * on its centre, to repeat along a column (`--_rule-pencil-v`, 4 × 40) or a row (`-h`, 40 × 4).
 */
function markProperties(mode) {
  const [hi, hiAlpha] = MARK.highlight[mode];
  const [blue, blueAlpha] = MARK.bracket[mode];
  const [pencil] = MARK.rule[mode];
  const highlight =
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='18'>` +
    `<path d='M2.5 4.6L12 3.4L28 3.9L37.2 3.1L38.6 7L37.4 11.2L38.9 14.6L28 14.9L12 14.3L1.4 15.2L2.8 10.6L1.2 7.4Z' ` +
    `fill='${hi}' fill-opacity='${hiAlpha}'/></svg>`;
  const bracket =
    `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='24'>` +
    `<path d='M6.6 1.4L3.4 1.9L2.3 4.6L2.4 8L2.4 16L2.2 19.5L3.1 22.2L6.4 22.7' fill='none' ` +
    `stroke='${blue}' stroke-opacity='${blueAlpha}' stroke-width='1.4' stroke-linecap='round' ` +
    `stroke-linejoin='round'/></svg>`;
  const wobble = [0, 0.28, -0.12, 0.34, 0.05, -0.3, -0.08, 0.22, 0];
  const ruleV =
    `<svg xmlns='http://www.w3.org/2000/svg' width='4' height='40'>` +
    `<path d='${polyline(wobble.map((dx, i) => [2 + dx, i * 5]))}' fill='none' stroke='${pencil}' ` +
    `stroke-width='1.1' stroke-linecap='round'/></svg>`;
  const ruleH =
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='4'>` +
    `<path d='${polyline(wobble.map((dy, i) => [i * 5, 2 + dy]))}' fill='none' stroke='${pencil}' ` +
    `stroke-width='1.1' stroke-linecap='round'/></svg>`;
  return [
    ["--_mark-highlight", highlight],
    ["--_mark-bracket", bracket],
    ["--_rule-pencil-v", ruleV],
    ["--_rule-pencil-h", ruleH],
  ].map(([name, image]) => [name, url(image)]);
}

const BEGIN = "/* draw-doodle-edges.mjs: begin generated block, do not edit by hand */";
const END = "/* draw-doodle-edges.mjs: end generated block */";

function block(properties) {
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

function sync(file, properties, check) {
  const path = `${THEMES}${file}`;
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(`  ${BEGIN}`);
  const end = text.indexOf(END);
  if (start === -1 || end === -1)
    throw new Error(`${file}: the generated block's markers are missing`);
  const current = text.slice(start, end + END.length);
  const wanted = block(properties);
  if (squash(current) === squash(wanted)) return true;
  if (check) return false;
  writeFileSync(path, text.slice(0, start) + wanted + text.slice(end + END.length));
  return true;
}

// `--geometry`: the surface's line and its frame's fill corner as JSON, for a test to measure.
if (process.argv.includes("--geometry")) {
  const { surface } = SHAPES;
  const { size, slice, stroke: width } = surface;
  console.log(
    JSON.stringify({
      size,
      slice,
      stroke: width,
      line: outline(surface),
      radius: fillRadius(surface),
    }),
  );
  process.exit(0);
}

const check = process.argv.includes("--check");
const stale = [
  ["line.css", lineProperties],
  ["marks.css", markProperties],
].filter(([file, properties]) => !sync(file, properties, check));
if (stale.length > 0) {
  console.error(
    `stale: ${stale.map(([file]) => `themes/cartoon/${file}`).join(", ")} — run node packages/ui/scripts/draw-doodle-edges.mjs`,
  );
  process.exit(1);
}
