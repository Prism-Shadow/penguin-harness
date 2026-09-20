/**
 * Colour parsing and WCAG 2 contrast, for tests that judge theme tokens by their computed values
 * instead of by a ratio typed into a comment.
 *
 * Covers the notations the theme files use: hex (3/4/6/8 digits), `rgb()`/`rgba()` in both the
 * comma and the space-and-slash syntax, `hsl()`/`hsla()`, `oklch()`, `color-mix(in srgb, …)`,
 * `transparent`, `white` and `black`. Anything else parses to `null`, and a caller reports that as
 * a failure — an unreadable colour is never assumed to pass.
 */

/** sRGB channels 0–255 (unrounded) and alpha 0–1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Splits on commas (or whitespace when there are none) at parenthesis depth 0. */
function splitTopLevel(text: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    const splits = separator === "," ? ch === "," : /\s/.test(ch);
    if (depth === 0 && splits) {
      if (current.trim() !== "") parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** `name(args)` → `[name, args]`, or null when the value is not a single function call. */
function functionCall(value: string): [string, string] | null {
  const match = /^([a-z-]+)\((.*)\)$/is.exec(value.trim());
  return match === null ? null : [match[1]!.toLowerCase(), match[2]!];
}

/** A number, or a percentage scaled so 100% = `percentScale`. */
function numberOrPercent(token: string, percentScale: number): number | null {
  const match = /^(-?\d*\.?\d+(?:e-?\d+)?)(%?)$/i.exec(token.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  return match[2] === "%" ? (n / 100) * percentScale : n;
}

function hue(token: string): number | null {
  const match = /^(-?\d*\.?\d+)(deg|turn|rad)?$/i.exec(token.trim());
  if (match === null) return null;
  const n = Number(match[1]);
  const unit = (match[2] ?? "deg").toLowerCase();
  return unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : n;
}

/** Channel and alpha tokens of a colour function, in either the legacy or the modern syntax. */
function channels(args: string): { values: string[]; alpha: string | undefined } | null {
  if (args.includes(",")) {
    const values = splitTopLevel(args, ",");
    if (values.length === 3) return { values, alpha: undefined };
    if (values.length === 4) return { values: values.slice(0, 3), alpha: values[3] };
    return null;
  }
  const [main, alpha, ...rest] = args.split("/");
  if (main === undefined || rest.length > 0) return null;
  const values = splitTopLevel(main, " ");
  if (values.length !== 3) return null;
  return { values, alpha: alpha?.trim() };
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = numberOrPercent(token, 1);
  return a === null ? null : clamp(a, 0, 1);
}

function parseHex(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex === undefined || hex.length === 5 || hex.length === 7) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const byte = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return {
    r: byte(0),
    g: byte(2),
    b: byte(4),
    a: full.length === 8 ? byte(6) / 255 : 1,
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** OKLCH → gamma-encoded sRGB 0–255, clamped to the gamut (Björn Ottosson's matrices). */
function oklchToRgb(lightness: number, chroma: number, hueDeg: number): [number, number, number] {
  const rad = (hueDeg * Math.PI) / 180;
  const A = chroma * Math.cos(rad);
  const B = chroma * Math.sin(rad);
  const l = (lightness + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (lightness - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (lightness - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (c: number) => {
    const v = clamp(c, 0, 1);
    return (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  };
  return [encode(linear[0]!), encode(linear[1]!), encode(linear[2]!)];
}

/** `color-mix(in srgb, A [p%], B [q%])`, premultiplied as CSS Color 5 specifies. */
function parseColorMix(args: string): Rgba | null {
  const [space, first, second, ...rest] = splitTopLevel(args, ",");
  if (space?.replace(/\s+/g, " ").toLowerCase() !== "in srgb" || rest.length > 0) return null;
  if (first === undefined || second === undefined) return null;
  const component = (part: string): { color: Rgba; pct: number | undefined } | null => {
    const tokens = splitTopLevel(part, " ");
    const pctToken = tokens.find((t) => /^-?\d*\.?\d+%$/.test(t));
    const colorText = tokens.filter((t) => t !== pctToken).join(" ");
    const color = parseColor(colorText);
    if (color === null) return null;
    return { color, pct: pctToken === undefined ? undefined : Number(pctToken.slice(0, -1)) };
  };
  const a = component(first);
  const b = component(second);
  if (a === null || b === null) return null;
  let p1 = a.pct;
  let p2 = b.pct;
  if (p1 === undefined && p2 === undefined) [p1, p2] = [50, 50];
  else if (p1 === undefined) p1 = 100 - p2!;
  else if (p2 === undefined) p2 = 100 - p1;
  const sum = p1 + p2!;
  if (sum <= 0) return null;
  const w1 = p1 / sum;
  const w2 = p2! / sum;
  const alpha = a.color.a * w1 + b.color.a * w2;
  const mix = (x: number, y: number) =>
    alpha === 0 ? 0 : (x * a.color.a * w1 + y * b.color.a * w2) / alpha;
  return {
    r: mix(a.color.r, b.color.r),
    g: mix(a.color.g, b.color.g),
    b: mix(a.color.b, b.color.b),
    a: alpha * Math.min(1, sum / 100),
  };
}

/** Parses a CSS colour value with no `var()` left in it. `null` when the notation is not covered. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();
  const lower = value.toLowerCase();
  if (lower === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (lower === "white") return WHITE;
  if (lower === "black") return BLACK;
  if (value.startsWith("#")) return parseHex(value);
  const call = functionCall(value);
  if (call === null) return null;
  const [name, args] = call;
  if (name === "color-mix") return parseColorMix(args);
  const parts = channels(args);
  if (parts === null) return null;
  const alpha = parseAlpha(parts.alpha);
  if (alpha === null) return null;
  const [c1, c2, c3] = parts.values as [string, string, string];
  if (name === "rgb" || name === "rgba") {
    const rgb = [c1, c2, c3].map((t) => numberOrPercent(t, 255));
    if (rgb.some((c) => c === null)) return null;
    const [r, g, b] = rgb.map((c) => clamp(c!, 0, 255)) as [number, number, number];
    return { r, g, b, a: alpha };
  }
  if (name === "hsl" || name === "hsla") {
    const h = hue(c1);
    const s = numberOrPercent(c2, 1);
    const l = numberOrPercent(c3, 1);
    if (h === null || s === null || l === null) return null;
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return { r, g, b, a: alpha };
  }
  if (name === "oklch") {
    const l = numberOrPercent(c1, 1);
    const c = numberOrPercent(c2, 0.4);
    const h = hue(c3);
    if (l === null || c === null || h === null) return null;
    const [r, g, b] = oklchToRgb(l, c, h);
    return { r, g, b, a: alpha };
  }
  return null;
}

/** `top` painted over `bottom` (source-over). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return {
    r: channel(top.r, bottom.r),
    g: channel(top.g, bottom.g),
    b: channel(top.b, bottom.b),
    a,
  };
}

/** WCAG 2 relative luminance of an opaque colour. */
export function relativeLuminance(color: Rgba): number {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/**
 * WCAG 2 contrast ratio of `fg` drawn on `bg`, 1–21. A translucent `fg` is composited over `bg`
 * first; `bg` must already be opaque — composite it over whatever it sits on before asking.
 */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  if (bg.a < 1)
    throw new Error("contrastRatio: composite the background onto an opaque layer first");
  const top = relativeLuminance(composite(fg, bg));
  const bottom = relativeLuminance(bg);
  const [light, dark] = top > bottom ? [top, bottom] : [bottom, top];
  return (light + 0.05) / (dark + 0.05);
}

/** `#rrggbb` (or `#rrggbbaa` when translucent), for messages. */
export function formatColor(color: Rgba): string {
  const hex = (n: number) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, "0");
  const alpha = color.a < 1 ? hex(color.a * 255) : "";
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${alpha}`;
}
