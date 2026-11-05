/**
 * Letter-avatar helpers (src/components/icons/avatars/avatar.ts): hue and tile determinism and
 * spread across names; initial extraction — grapheme based (CJK, ZWJ emoji and flags stay whole),
 * uppercasing, and the empty/whitespace → fallback → "?" chain; and an exhaustive WCAG check that
 * both inks the tile's one `light-dark()` value carries keep ≥ 4.5:1 against the tinted tile over
 * every surface the themes declare, for all 360 hues.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avatarHue,
  avatarInitial,
  avatarTile,
  avatarTileOfHue,
} from "../src/components/icons/avatars/avatar";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_MODES } from "../src/tokens";
import type { ThemeId, ThemeModeName } from "../src/tokens";
import {
  BLACK,
  WHITE,
  analyzeThemeFile,
  composite,
  contrastRatio,
  parseColor,
  resolveThemeValue,
} from "../src/testing";
import type { ThemeFileAnalysis } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

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

  it("formats the tint and the two inks from the key's hue, and joins the inks in light-dark()", () => {
    const h = avatarHue("x");
    expect(avatarTile("x")).toEqual({
      bg: `hsl(${h} 55% 50% / 0.14)`,
      fg: `hsl(${h} 55% 27%)`,
      fgDark: `hsl(${h} 55% 77%)`,
      ink: `light-dark(hsl(${h} 55% 27%), hsl(${h} 55% 77%))`,
    });
    expect(avatarTile("x")).toEqual(avatarTileOfHue(h));
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

// ---- WCAG contrast of the initial ink on the tinted tile (every theme, both modes, all hues) ----

/**
 * The surfaces a tile sits on, per theme and mode, read from the theme files: the page, a card
 * and the muted fill of a list, plus the gray steps the app still paints list grounds, row hovers
 * and selected rows with (white, gray-50 and gray-100 in light; gray-900, 800 and 700 in dark). A
 * theme that declares no gray bridge of its own falls back to the default theme's, as the
 * cascade does.
 */
const SURFACES: Readonly<Record<ThemeModeName, readonly string[]>> = {
  light: [
    "--ui-canvas",
    "--ui-surface",
    "--ui-surface-muted",
    "--color-white",
    "--color-gray-50",
    "--color-gray-100",
  ],
  dark: [
    "--ui-canvas",
    "--ui-surface",
    "--ui-surface-muted",
    "--color-gray-900",
    "--color-gray-800",
    "--color-gray-700",
  ],
};

function themeAnalysis(id: ThemeId): ThemeFileAnalysis | null {
  const path = join(SRC_DIR, "themes", `${id}.css`);
  if (!existsSync(path)) return null;
  const analysis = analyzeThemeFile(readFileSync(path, "utf8"), id);
  return analysis.isStub ? null : analysis;
}

describe("avatarTile contrast (WCAG AA)", () => {
  const defaultTheme = themeAnalysis(DEFAULT_THEME_ID);

  it("reads the default theme", () => {
    expect(defaultTheme).not.toBeNull();
  });

  for (const id of THEME_IDS) {
    const theme = themeAnalysis(id);
    if (theme === null || defaultTheme === null) {
      it.skip(`${id} — PENDING: themes/${id}.css declares no tokens yet`, () => {});
      continue;
    }
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: the initial keeps ≥ 4.5:1 on the tile, for every hue on every surface`, () => {
        const failures: string[] = [];
        const surfaces = SURFACES[mode].flatMap((name) => {
          const value = resolveThemeValue(name, mode, theme, defaultTheme);
          const color = value === null ? null : parseColor(value);
          if (color === null) {
            failures.push(`${name} does not resolve to a colour (${String(value)})`);
            return [];
          }
          return [{ name, color: composite(color, mode === "light" ? WHITE : BLACK) }];
        });
        for (let h = 0; h < 360; h++) {
          const tile = avatarTileOfHue(h);
          const ink = parseColor(mode === "light" ? tile.fg : tile.fgDark)!;
          const tint = parseColor(tile.bg)!;
          for (const surface of surfaces) {
            const ratio = contrastRatio(ink, composite(tint, surface.color));
            if (ratio < 4.5) failures.push(`hue ${h} on ${surface.name}: ${ratio.toFixed(2)}:1`);
          }
        }
        expect(failures, `\n${failures.join("\n")}\n`).toEqual([]);
      });
    }
  }
});
