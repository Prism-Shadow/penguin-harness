/**
 * Letter-avatar helper unit tests: hue/tile determinism and spread across
 * names; initial extraction — grapheme based (CJK / ZWJ emoji / flags stay
 * whole), uppercasing, and the empty/whitespace → fallback → "?" chain; and
 * an exhaustive WCAG check that both theme inks keep ≥ 4.5:1 contrast against
 * the tinted tile over every app surface, for all 360 hues.
 */
import { describe, expect, it } from "vitest";
import { avatarHue, avatarInitial, avatarTile } from "../src/lib/avatar";

describe("avatarHue / avatarTile", () => {
  it("is deterministic for the same key", () => {
    expect(avatarHue("my-provider")).toBe(avatarHue("my-provider"));
    expect(avatarTile("agent-1")).toEqual(avatarTile("agent-1"));
  });

  it("stays inside the 0-359 hue range", () => {
    for (const key of ["", "a", "my-provider", "深度求索", "🐧"]) {
      const hue = avatarHue(key);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads distinct hues across realistic group names", () => {
    const names = ["my-llm", "local-vllm", "team-proxy", "backup"];
    expect(new Set(names.map(avatarHue)).size).toBe(names.length);
  });

  it("formats the tint background and the two theme inks from the key's hue", () => {
    const h = avatarHue("x");
    expect(avatarTile("x")).toEqual({
      bg: `hsl(${h} 55% 50% / 0.14)`,
      fg: `hsl(${h} 55% 28%)`,
      fgDark: `hsl(${h} 55% 73%)`,
    });
  });
});

describe("avatarInitial", () => {
  it("takes the first character, uppercased", () => {
    expect(avatarInitial("my-provider")).toBe("M");
    expect(avatarInitial("Zeta")).toBe("Z");
  });

  it("keeps case-less characters (CJK) as-is", () => {
    expect(avatarInitial("深度求索")).toBe("深");
  });

  it("treats a surrogate-pair character as one initial", () => {
    expect(avatarInitial("🐧 harness")).toBe("🐧");
  });

  it("keeps multi-code-point grapheme clusters whole (ZWJ emoji, flags)", () => {
    expect(avatarInitial("👩‍💻 dev tools")).toBe("👩‍💻");
    expect(avatarInitial("🇨🇦 north")).toBe("🇨🇦");
  });

  it("trims whitespace before picking the initial", () => {
    expect(avatarInitial("  agent")).toBe("A");
  });

  it("falls back to the fallback's initial, then ?", () => {
    expect(avatarInitial("", "agent-1")).toBe("A");
    expect(avatarInitial("   ", " x")).toBe("X");
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("  ", "  ")).toBe("?");
  });
});

// ---- WCAG contrast of the initial ink on the tinted tile (both themes, all hues) ----

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The 14%-alpha tile tint composited over a surface (sRGB blend, like the browser). */
function tileOver(h: number, surface: [number, number, number]): [number, number, number] {
  const tint = hslToRgb(h, 55, 50);
  return [0, 1, 2].map((i) => tint[i]! * 0.14 + surface[i]! * 0.86) as [number, number, number];
}

const hexRgb = (s: string) =>
  [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];

// App surfaces the tile sits on: light = white / gray-50 rows / gray-100 hover;
// dark = the true-neutral overrides in styles.css (gray-900/800/700).
const LIGHT_SURFACES = ["#ffffff", "#f9fafb", "#f3f4f6"].map(hexRgb);
const DARK_SURFACES = ["#0d0d0d", "#1f1f1f", "#303030"].map(hexRgb);

/** Saturation/lightness actually emitted by avatarTile (parsed so this test can't drift from the implementation). */
function parseSL(color: string): [number, number] {
  const m = /^hsl\(\d+ (\d+)% (\d+)%\)$/.exec(color);
  expect(m, `unexpected ink format: ${color}`).toBeTruthy();
  return [Number(m![1]), Number(m![2])];
}

describe("avatarTile contrast (WCAG AA)", () => {
  it("keeps ≥ 4.5:1 for every hue: light ink on light surfaces, dark ink on dark surfaces", () => {
    const sample = avatarTile("x");
    const [fgS, fgL] = parseSL(sample.fg);
    const [fgDarkS, fgDarkL] = parseSL(sample.fgDark);
    for (let h = 0; h < 360; h++) {
      const fg = hslToRgb(h, fgS, fgL);
      const fgDark = hslToRgb(h, fgDarkS, fgDarkL);
      for (const surface of LIGHT_SURFACES) {
        expect(contrast(fg, tileOver(h, surface))).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of DARK_SURFACES) {
        expect(contrast(fgDark, tileOver(h, surface))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
