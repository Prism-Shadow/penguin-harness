/**
 * WCAG 2 contrast arithmetic for the Colour page. Colours arrive as 8-bit sRGB (the browser
 * resolves any CSS colour — `color-mix()`, `oklch()` — by painting it; see token-probe.ts), so
 * this module only parses the plain forms and does the maths.
 */

export interface Rgba {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` in comma or space syntax, `transparent`. */
export function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = "f"] = [...hex].map((ch) => ch + ch);
      return {
        r: parseInt(r!, 16),
        g: parseInt(g!, 16),
        b: parseInt(b!, 16),
        a: parseInt(a.length === 2 ? a : a + a, 16) / 255,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(v)?.[1];
  if (fn === undefined) return null;
  const [channels, slashAlpha] = fn.split("/").map((s) => s.trim());
  const parts = (channels ?? "").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (s: string) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
  const alphaText = slashAlpha ?? parts[3];
  const alpha =
    alphaText === undefined
      ? 1
      : alphaText.endsWith("%")
        ? parseFloat(alphaText) / 100
        : parseFloat(alphaText);
  const [r, g, b] = parts.slice(0, 3).map(channel);
  if ([r, g, b, alpha].some((n) => n === undefined || Number.isNaN(n))) return null;
  return { r: r!, g: g!, b: b!, a: alpha };
}

/** Source-over compositing of `top` onto an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two opaque colours, 1–21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text thresholds: 4.5 body, 3 large text and non-text marks. */
export function wcagGrade(ratio: number): "AAA" | "AA" | "AA large" | "fail" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA large";
  return "fail";
}

export function toHex({ r, g, b, a }: Rgba): string {
  const h = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
}
