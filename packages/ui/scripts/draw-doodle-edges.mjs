/**
 * Draws the Doodle pack's pen lines and writes them, as the custom properties its recipes read,
 * into the generated block of `src/themes/doodle/recipes.css`.
 *
 *   node packages/ui/scripts/draw-doodle-edges.mjs          rewrite the block
 *   node packages/ui/scripts/draw-doodle-edges.mjs --check  exit 1 if the block is stale
 *
 * The line. Each shape is one rounded rectangle traced by a felt tip from a fixed seed: the
 * straight runs wander slightly off true, every corner is a plump smooth arc, and the pen starts
 * a hair inside the box on the top-left and runs out onto the line, the start overlap of a drawn
 * loop. A redraw prints the same bytes, so the recipes change only when a parameter here does.
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

/** Inks, per mode: warm roasted cocoa marker ink in light, warm cream chalk in dark. */
const INK = {
  ink: { light: "#382820", dark: "#e3d8c6" },
  danger: { light: "#b3261e", dark: "#ff8f7f" },
  blue: { light: "#8f2d3d", dark: "#f78fa0" },
};

/** The fill a floating slip is painted in: `--ui-overlay`. */
const OVERLAY = { light: "#fffdf9", dark: "#26211d" };

/** The shadow under a slip: a warm cocoa sticker offset shadow and soft warm aura. */
const SHADOW = {
  light: { color: "#382820", contact: 0.24, far: 0.036 },
  dark: { color: "#000000", contact: 0.55, far: 0.075 },
};

/** The margin a glass image keeps round its outline for the shadow; the recipes' outset. */
const MARGIN = 12;

/**
 * Plump, smooth cartoon shapes with high `arcSteps` and gentle felt-tip `wander` so stretched
 * controls and wide inputs never show polygonal corners or smeared runs.
 */
const SHAPES = {
  control: {
    size: 44,
    slice: 14,
    radius: 10,
    stroke: 2,
    seed: 5,
    arcSteps: 8,
    wander: { run: 0.35, arc: 0.22 },
    tail: true,
    bitmap: true,
    clip: true,
  },
  bubble: {
    size: 56,
    slice: 20,
    radius: [18, 18, 5, 18],
    stroke: 2.1,
    seed: 11,
    arcSteps: 8,
    wander: { run: 0.38, arc: 0.25 },
    tail: true,
    bitmap: true,
    clip: true,
  },
  pill: {
    size: 56,
    slice: 22,
    radius: 20,
    stroke: 2.1,
    seed: 17,
    arcSteps: 10,
    wander: { run: 0.32, arc: 0.2 },
    bitmap: true,
  },
  bead: {
    size: 34,
    slice: 13,
    radius: 11,
    stroke: 1.9,
    seed: 29,
    arcSteps: 8,
    wander: { run: 0.28, arc: 0.18 },
    bitmap: true,
  },
  box: {
    size: 20,
    slice: 7,
    radius: 4,
    stroke: 1.8,
    seed: 23,
    arcSteps: 6,
    wander: { run: 0.28, arc: 0.2 },
    clip: true,
  },
  fab: {
    size: 52,
    slice: 18,
    radius: 14,
    stroke: 2.2,
    seed: 37,
    arcSteps: 8,
    wander: { run: 0.35, arc: 0.22 },
    tail: true,
    clip: true,
  },
};

/** The slips of what floats: the outline, its fill and its shadow in one image. */
const SLIPS = {
  label: {
    size: 32,
    slice: 11,
    radius: 7,
    stroke: 1.9,
    seed: 5,
    arcSteps: 6,
    wander: { run: 0.35, arc: 0.22 },
    tail: true,
  },
  slip: {
    size: 54,
    slice: 18,
    radius: 14,
    stroke: 2,
    seed: 41,
    arcSteps: 8,
    wander: { run: 0.35, arc: 0.22 },
    tail: true,
  },
  sheet: {
    size: 72,
    slice: 28,
    radius: 24,
    stroke: 2.2,
    seed: 43,
    arcSteps: 10,
    wander: { run: 0.35, arc: 0.22 },
    tail: true,
  },
};

const INSET = 2;
const WANDER = { run: 0.4, arc: 0.25 };

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
 * The outline's points, `off` px outside the drawn line (0 for the line itself).
 */
function outline(shape, off = 0) {
  const { size, seed, arcSteps = 6, wander = WANDER } = shape;
  const [tl, tr, br, bl] = corners(shape);
  const next = random(seed);
  const jitter = (amount) => (next() * 2 - 1) * amount;
  const lo = INSET;
  const hi = size - INSET;
  const points = [];
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

const f = (v) => Number(v.toFixed(2));
const d1 = (v) => Number(v.toFixed(1));
const polyline = (pts) => `M${pts.map(([x, y]) => `${d1(x)} ${d1(y)}`).join("L")}`;

function tail(points, shape) {
  const [x0, y0] = points[points.top];
  const end = Math.min(x0 + 2.2, shape.slice - 0.4);
  return [
    [end - 5.5, y0 + 1.6],
    [end, y0 - 0.1],
  ];
}

function linePath(shape) {
  const points = outline(shape);
  return {
    loop: `${polyline(points)}Z`,
    tail: shape.tail ? polyline(tail(points, shape)) : "",
  };
}

function lineLines(shape) {
  const points = outline(shape);
  return [
    { points, closed: true },
    ...(shape.tail ? [{ points: tail(points, shape), closed: false }] : []),
  ];
}

const svg = (size, inner) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${inner}</svg>`;

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

function glass(shape, ink, mode) {
  const { size, radius } = shape;
  const { color, contact, far } = SHADOW[mode];
  const ring = (y, width) =>
    `<rect x='${INSET}' y='${INSET + y}' width='${size - 2 * INSET}' ` +
    `height='${size - 2 * INSET}' rx='${radius}' stroke-width='${width}'/>`;
  const shadow =
    `<g fill='none' stroke='${color}'><g stroke-opacity='${contact}'>${ring(2, 2)}</g>` +
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

function clip(shape) {
  const points = outline(shape, shape.stroke / 2 + 0.25);
  const [first, ...rest] = points.map(([x, y]) => `${coord(x, shape)} ${coord(y, shape)}`);
  return `shape(from ${first}, ${rest.map((p) => `line to ${p}`).join(", ")}, close)`;
}

const encode = (text) =>
  text.replace(/[<>#%"{}|\\^`\n]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const url = (text) => `url("data:image/svg+xml,${encode(text)}")`;

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

function clover(notch = 42.6, steps = 14) {
  const slack = 100 - 2 * notch;
  const offset = (-slack + Math.sqrt(slack * slack + 4 * (2500 - notch * notch))) / 2;
  const radius = 50 - offset;
  const points = [];
  for (let leaf = 0; leaf < 4; leaf++) {
    const turn = (leaf * Math.PI) / 2;
    const cx = 50 + offset * Math.SQRT2 * Math.cos(turn - Math.PI / 4);
    const cy = 50 + offset * Math.SQRT2 * Math.sin(turn - Math.PI / 4);
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
