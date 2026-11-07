/**
 * Draws the hand-drawn outlines the Doodle theme (`themes/cartoon.css`) lays on a box's edge, and
 * prints them as the CSS custom properties that file declares.
 *
 *   node packages/ui/scripts/draw-doodle-edges.mjs
 *
 * Each outline is one rounded rectangle traced by a pen: the straight runs wander a fraction of a
 * pixel off true, every corner is a slightly uneven arc, and the pen overshoots where the stroke
 * began, at the top-left corner. The randomness comes from a fixed seed, so a redraw prints the
 * same bytes and the theme file changes only when a parameter here does. The theme applies each
 * one as a `border-image` 9-slice: the corners keep their drawn shape, the runs between them
 * stretch along the box, and no box draws its own line at run time.
 *
 * Two sizes — `control` for a button or a text field, `surface` for a card, a dialog, a menu or a
 * bubble — each in the light ink and the dark chalk, and the control again in the danger ink for
 * a field that failed validation. The ink values are the theme's line inks, spelled here because
 * an image cannot read a custom property; change them together with the theme file.
 */

const INKS = {
  light: "#352e29",
  dark: "#d9d1c1",
  "danger-light": "#b3261e",
  "danger-dark": "#ff8f7f",
};

/** `size` is the square image; `slice` the corner region the theme cuts it at. */
const SHAPES = {
  control: { size: 28, slice: 9, radius: 5, stroke: 1.45, seed: 5 },
  surface: { size: 48, slice: 14, radius: 7, stroke: 1.55, seed: 11 },
};

const EDGES = [
  ["--_edge-control", "control", "light"],
  ["--_edge-control", "control", "dark"],
  ["--_edge-control-danger", "control", "danger-light"],
  ["--_edge-control-danger", "control", "danger-dark"],
  ["--_edge-surface", "surface", "light"],
  ["--_edge-surface", "surface", "dark"],
];

/** A small linear congruential generator: the same seed, the same line. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function outline({ size, radius, seed }) {
  const next = random(seed);
  const jitter = (amount) => (next() * 2 - 1) * amount;
  const inset = 1;
  const lo = inset;
  const hi = size - inset;
  const points = [];
  // A straight run, from one corner's arc to the next, wandering up to 0.45px off true.
  const run = (x0, y0, x1, y1) => {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      points.push([x0 + (x1 - x0) * t + jitter(0.45), y0 + (y1 - y0) * t + jitter(0.45)]);
    }
  };
  // A quarter arc whose radius wavers by up to half a pixel.
  const arc = (cx, cy, start) => {
    for (let k = 0; k <= 3; k++) {
      const angle = start + (k / 3) * (Math.PI / 2);
      const r = radius + jitter(0.5);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  };
  run(lo + radius, lo, hi - radius, lo);
  arc(hi - radius, lo + radius, -Math.PI / 2);
  run(hi, lo + radius, hi, hi - radius);
  arc(hi - radius, hi - radius, 0);
  run(hi - radius, hi, lo + radius, hi);
  arc(lo + radius, hi - radius, Math.PI / 2);
  run(lo, hi - radius, lo, lo + radius);
  arc(lo + radius, lo + radius, Math.PI);
  const f = (v) => Number(v.toFixed(2));
  const body = `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
  // The pen's overshoot where the stroke began: a short tail past the top-left arc.
  const tail = `M${f(lo + radius - 3)} ${f(lo + 0.5)}L${f(lo + radius + 3.5)} ${f(lo - 0.2)}`;
  return `${body}${tail}`;
}

function svg(shape, ink) {
  const { size, stroke } = shape;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<path d='${outline(shape)}' fill='none' stroke='${ink}' stroke-width='${stroke}' ` +
    `stroke-linecap='round' stroke-linejoin='round'/></svg>`
  );
}

/** Percent-encodes only what a CSS `url("…")` holding SVG needs encoded. */
const encode = (text) =>
  text.replace(/[<>#%"{}|\\^`\n]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

for (const [name, shapeName, inkName] of EDGES) {
  const shape = SHAPES[shapeName];
  console.log(`/* ${shapeName}, ${inkName} — slice ${shape.slice} */`);
  console.log(`${name}: url("data:image/svg+xml,${encode(svg(shape, INKS[inkName]))}");`);
}
