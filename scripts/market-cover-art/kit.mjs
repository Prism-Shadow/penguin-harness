/**
 * The drawing kit every market cover is built from: the canvas, the palette a cover derives from
 * its one hue, the lit field, and the solid objects that stand on it (each with the same key light,
 * rim and two-layer shadow). Scenes compose these and nothing else, so a new cover inherits the
 * light, the corners and the shadows of the set.
 *
 * Coordinates are on a 1600 × 900 canvas (16:9). The subject stays inside SAFE, the middle of the
 * square a 1:1 crop keeps, so a card that crops the cover anywhere between 16:9 and 1:1 still shows
 * it whole; the wings outside the square carry only the field and backdrop.
 */

export const W = 1600;
export const H = 900;
export const CX = W / 2;
export const CY = H / 2;

/** Where the subject must sit: inside the 1:1 crop's square, clear of its edges. */
export const SAFE = { x0: 470, x1: 1130, y0: 130, y1: 790 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;

function oklabToLinearSrgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** An OKLCH colour as `#rrggbb`, its chroma reduced until it fits sRGB. */
export function oklch(L, C, h) {
  const light = clamp(L, 0, 1);
  let chroma = Math.max(0, C);
  for (;;) {
    const rad = (h * Math.PI) / 180;
    const rgb = oklabToLinearSrgb(light, chroma * Math.cos(rad), chroma * Math.sin(rad));
    if (chroma < 1e-4 || rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
      return `#${rgb
        .map((v) => Math.round(clamp(encode(clamp(v, 0, 1)), 0, 1) * 255))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
    }
    chroma *= 0.95;
  }
}

/** `h` moved `deg` degrees along the shorter arc toward `target` (never past it). */
function toward(h, target, deg) {
  const diff = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), deg) + 360) % 360;
}

/**
 * A cover's colours, all from one hue. Lights lean a few degrees toward yellow and shadows toward
 * blue, as lit paint does, so a single hue still reads as a lit volume instead of a flat swatch.
 * `l` and `c` are the field's own lightness and chroma: the middle of the field is that colour,
 * which is what the market document's `tone` names.
 */
export function palette({ h, l = 0.55, c = 0.12 }) {
  const warm = (d) => toward(h, 85, d);
  const cool = (d) => toward(h, 265, d);
  return {
    h,
    l,
    c,
    light: oklch(l + 0.15, c * 0.85, warm(6)),
    field0: oklch(l + 0.06, c, warm(4)),
    base: oklch(l, c, h),
    field1: oklch(l - 0.15, c * 0.95, cool(8)),
    deep: oklch(Math.min(l - 0.2, 0.36), c * 0.95, cool(8)),
    ink: oklch(Math.min(l - 0.1, 0.44), c * 1.05, h),
    mid: oklch(0.68, c * 0.95, h),
    soft: oklch(0.83, c * 0.5, warm(3)),
    tint: oklch(0.93, c * 0.22, warm(3)),
    paper: oklch(0.985, c * 0.05, warm(5)),
    accent: oklch(Math.max(l + 0.1, 0.68), c * 1.5, warm(3)),
    shade: oklch(clamp(l - 0.36, 0.12, 0.24), c * 0.7, cool(14)),
  };
}

/**
 * One cover being drawn: its palette, the `<defs>` it has asked for so far, and ids unique within
 * the file. Gradients and filters are defined once per file, however many objects use them.
 */
export class Art {
  constructor(pal) {
    this.pal = pal;
    this.defs = new Map();
    this.n = 0;
  }

  uid(prefix) {
    this.n += 1;
    return `${prefix}${this.n}`;
  }

  /** A definition keyed by what it is, so a second request returns the first id. */
  def(key, make) {
    const found = this.defs.get(key);
    if (found !== undefined) return found.id;
    const id = this.uid("d");
    this.defs.set(key, { id, markup: make(id) });
    return id;
  }

  /** A linear gradient between two points; `stops` are colours, or [colour, opacity, offset]. */
  linear(stops, [x1, y1, x2, y2] = [0, 0, 0, 1], units = "objectBoundingBox") {
    const key = `lin|${JSON.stringify(stops)}|${x1},${y1},${x2},${y2}|${units}`;
    const id = this.def(
      key,
      (id) =>
        `<linearGradient id="${id}" gradientUnits="${units}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopList(stops)}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  /** A radial gradient, in canvas units unless `units` says otherwise. */
  radial(stops, [cx, cy, r], units = "userSpaceOnUse", [sx, sy] = [1, 1]) {
    const key = `rad|${JSON.stringify(stops)}|${cx},${cy},${r}|${units}|${sx},${sy}`;
    const scale =
      sx !== 1 || sy !== 1
        ? ` gradientTransform="translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})"`
        : "";
    const id = this.def(
      key,
      (id) =>
        `<radialGradient id="${id}" gradientUnits="${units}" cx="${cx}" cy="${cy}" r="${r}"${scale}>${stopList(stops)}</radialGradient>`,
    );
    return `url(#${id})`;
  }

  /** A Gaussian blur, its region wide enough that no shadow is cut square. */
  blur(sd) {
    const id = this.def(
      `blur|${sd}`,
      (id) =>
        `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sd}"/></filter>`,
    );
    return `url(#${id})`;
  }

  /** A clip path from shape markup, for content that must stay inside an object's face. */
  clip(shape) {
    const id = this.def(`clip|${shape}`, (id) => `<clipPath id="${id}">${shape}</clipPath>`);
    return `url(#${id})`;
  }

  /** The vertical face of a paper object: white at the top, the hue's tint at the foot. */
  get paperFill() {
    return this.linear([this.pal.paper, this.pal.tint]);
  }

  /** The rim the key light draws along an object's upper edge, fading down its sides. */
  get rim() {
    return this.linear([
      ["#ffffff", 0.95, 0],
      ["#ffffff", 0, 0.42],
    ]);
  }

  /**
   * The shadow every floating object casts, down and to the right of the key light: a wide soft
   * fall plus a tight contact shade. `lift` is how far the object floats above the field.
   */
  shadow(shape, lift = 24, strength = 1) {
    return this.cast((color) => `<g fill="${color}">${shape}</g>`, lift, strength);
  }

  /** The same shadow for a silhouette that paints itself: `draw(color)` returns its markup. */
  cast(draw, lift = 24, strength = 1) {
    const { shade } = this.pal;
    const dx = round(lift * 0.3);
    return [
      `<g opacity="${round(0.42 * strength)}" filter="${this.blur(Math.round(lift * 0.95))}">`,
      `<g transform="translate(${dx} ${lift})">${draw(shade)}</g></g>`,
      `<g opacity="${round(0.3 * strength)}" filter="${this.blur(Math.max(2, Math.round(lift * 0.18)))}">`,
      `<g transform="translate(${round(dx * 0.25)} ${round(lift * 0.22)})">${draw(shade)}</g></g>`,
    ].join("");
  }

  /**
   * A solid object: its shadow, its face and the rim of light along its top. `shape` is fill-less
   * markup (a rect, a path) reused for all three.
   */
  solid(shape, { fill = this.paperFill, lift = 24, rim = 3, shadow = 1, extra = "" } = {}) {
    return [
      shadow > 0 ? this.shadow(shape, lift, shadow) : "",
      `<g fill="${fill}">${shape}</g>`,
      extra,
      rim > 0 ? `<g fill="none" stroke="${this.rim}" stroke-width="${rim}">${shape}</g>` : "",
    ].join("");
  }

  /** The finished SVG document. */
  svg(body, title) {
    const defs = [...this.defs.values()].map((d) => d.markup).join("");
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
      title !== undefined ? `<title>${escapeXml(title)}</title>` : "",
      `<defs>${defs}</defs>`,
      body,
      `</svg>`,
    ].join("");
  }
}

function stopList(stops) {
  return stops
    .map((s, i) => {
      const [color, opacity = 1, offset = stops.length === 1 ? 0 : i / (stops.length - 1)] =
        Array.isArray(s) ? s : [s];
      const op = opacity === 1 ? "" : ` stop-opacity="${opacity}"`;
      return `<stop offset="${round(offset)}" stop-color="${color}"${op}/>`;
    })
    .join("");
}

export function escapeXml(s) {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
}

/**
 * The field: one hue lit from the upper left, deepening toward the lower right, with a soft key
 * light behind the subject and the corners settling into shade. Every cover stands on it.
 */
export function field(art, { light = [700, 330], reach = 760 } = {}) {
  const p = art.pal;
  const wash = art.linear([p.field0, p.base, p.field1], [260, -80, 1340, 980], "userSpaceOnUse");
  const key = art.radial(
    [
      [p.light, 0.85, 0],
      [p.light, 0.32, 0.45],
      [p.light, 0, 1],
    ],
    [light[0], light[1], reach],
    "userSpaceOnUse",
    [1.25, 1],
  );
  const vignette = art.radial(
    [
      [p.field1, 0, 0.55],
      [p.field1, 0.55, 1],
    ],
    [CX, CY - 20, 980],
    "userSpaceOnUse",
    [1, 0.78],
  );
  return [
    `<rect width="${W}" height="${H}" fill="${wash}"/>`,
    `<rect width="${W}" height="${H}" fill="${key}"/>`,
    `<rect width="${W}" height="${H}" fill="${vignette}"/>`,
  ].join("");
}

/**
 * The backdrop behind the subject, quieter than anything in front of it. `rings`: circles centred
 * on the subject; `squares`: the app tile's outline, repeated outward.
 */
export function backdrop(art, kind, { cx = CX, cy = CY, step = 120, from = 300, count = 5 } = {}) {
  const p = art.pal;
  if (kind === "rings" || kind === "squares") {
    const out = [];
    for (let i = 0; i < count; i++) {
      const r = from + i * step;
      const op = round(0.2 - i * 0.03);
      if (op <= 0) break;
      out.push(
        kind === "rings"
          ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.light}" stroke-opacity="${op}" stroke-width="3"/>`
          : `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" rx="${round(r * 0.46)}" fill="none" stroke="${p.light}" stroke-opacity="${op}" stroke-width="3"/>`,
      );
    }
    return out.join("");
  }
  return "";
}

/** A rounded rectangle as markup, the one corner rule of the set: radius ∝ the shorter side. */
export function rect(x, y, w, h, r = Math.min(w, h) * 0.12) {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(r)}"/>`;
}

/** An app tile's corner: the home screen's squircle proportion. */
export const TILE_RADIUS = 0.235;

/**
 * A 24 × 24 line icon, the product's own icon format, drawn at `size` around (cx, cy) with its
 * stroke scaled with it, so a glyph keeps the weight it has in the app.
 */
export function glyph(icon, { cx, cy, size, color, width = 1.7, fill = "none", opacity = 1 }) {
  const s = size / 24;
  const op = opacity === 1 ? "" : ` opacity="${opacity}"`;
  return `<g transform="translate(${round(cx - size / 2)} ${round(cy - size / 2)}) scale(${round(s * 1000) / 1000})" fill="${fill}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${op}>${icon}</g>`;
}

/** An app tile: a paper square with the home screen's corner, floating, its glyph in the hue's ink. */
export function tile(
  art,
  { cx, cy, size, icon, lift = 30, fill, color, width = 1.7, glyphScale = 0.56 },
) {
  const shape = rect(cx - size / 2, cy - size / 2, size, size, size * TILE_RADIUS);
  return (
    art.solid(shape, { fill: fill ?? art.paperFill, lift, rim: Math.max(2, size / 90) }) +
    (icon !== undefined
      ? glyph(icon, { cx, cy, size: size * glyphScale, color: color ?? art.pal.ink, width })
      : "")
  );
}

/** A point on the isometric grid: x runs down-right, y down-left, z up, all in canvas units. */
export function iso([ox, oy], x, y, z = 0) {
  const c = Math.cos(Math.PI / 6);
  return [round(ox + (x - y) * c), round(oy + (x + y) * 0.5 - z)];
}

const pts = (list) => list.map((p) => p.join(",")).join(" ");

/**
 * An isometric box standing on (x, y) of the grid at `origin`, `w` along x, `d` along y, `h` tall.
 * The key light is above and to the left: the top is the lightest face, the left one next.
 */
export function isoBox(origin, { x = 0, y = 0, z = 0, w, d, h, top, left, right, stroke }) {
  const P = (a, b, c) => iso(origin, a, b, c);
  const t = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const l = [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)];
  const r = [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)];
  const st =
    stroke !== undefined ? ` stroke="${stroke}" stroke-width="2" stroke-linejoin="round"` : "";
  return [
    `<polygon points="${pts(l)}" fill="${left}"${st}/>`,
    `<polygon points="${pts(r)}" fill="${right}"${st}/>`,
    `<polygon points="${pts(t)}" fill="${top}"${st}/>`,
  ].join("");
}

/** The outline an isometric box covers on the canvas, for its shadow. */
export function isoFootprint(origin, { x = 0, y = 0, z = 0, w, d, h }) {
  const P = (a, b, c) => iso(origin, a, b, c);
  return `<polygon points="${pts([
    P(x, y, z + h),
    P(x + w, y, z + h),
    P(x + w, y, z),
    P(x + w, y + d, z),
    P(x, y + d, z),
    P(x, y + d, z + h),
  ])}"/>`;
}

export { pts, round };
