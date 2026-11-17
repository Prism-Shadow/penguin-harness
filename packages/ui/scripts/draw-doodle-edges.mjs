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

const RECIPES = fileURLToPath(new URL("../src/themes/doodle/recipes.css", import.meta.url));
const ROOT = ':root[data-theme="doodle"]';

const INK = { light: "#51394e", dark: "#ead9e6" };
const OVERLAY = { light: "#fffbf7", dark: "#322a36" };

/** The shadow under a slip: a warm cocoa sticker offset shadow and soft warm aura. */
const SHADOW = {
  light: { color: "#382820", contact: 0.24, far: 0.036 },
  dark: { color: "#000000", contact: 0.55, far: 0.075 },
};

/** The margin a glass image keeps round its outline for the shadow; the recipes' outset. */
const MARGIN = 12;

const LABEL = {
  size: 32,
  slice: 11,
  radius: 7,
  stroke: 1.9,
  seed: 5,
  arcSteps: 6,
  wander: { run: 0.35, arc: 0.22 },
  tail: true,
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

const svg = (size, inner) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${inner}</svg>`;

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
  const props = [["--_glass-label", url(glass(LABEL, INK[mode], mode))]];
  if (mode === "light") props.push(["--_clip-cookie", cookie()], ["--_clip-clover", clover()]);
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

const squash = (text) => text.replace(/\s+/g, "");

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
