/**
 * The icon family (src/lib/icon-scale.ts and the renderers in components/ui).
 *
 * These are source scans rather than render assertions, because the thing that decays is not any
 * one component's output — it is a new inline `<svg>` re-drawing a glyph the app already owns, at
 * a stroke weight nobody chose. The three paths asserted below each used to exist in five or six
 * hand-typed copies.
 *
 * The scans cover the web app and the shared UI package (test/helpers/roots.ts): a glyph that moves
 * into the package keeps its one home, and a copy re-typed on either side is still a second copy.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, ICON_GAP } from "../src/lib/icon-scale";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_MODES } from "../../ui/src/tokens";
import { analyzeThemeFile, resolveThemeValue } from "../../ui/src/testing/theme-tokens";
import { expectEveryRootScanned, expectSingleHome, scanSources, sourceFile } from "./helpers/roots";

const SCAN = scanSources();

// Every file id is repo-relative with forward slashes whatever the platform separator is, so the
// expected paths below read the same on Windows as they do everywhere else.
const FILES = SCAN.files
  .filter((file) => file.name.endsWith(".ts") || file.name.endsWith(".tsx"))
  .map((file) => [file.id, file.text] as const);

/** Every file containing `needle`, by repo-relative id. */
const occurrences = (needle: string) =>
  FILES.filter(([, src]) => src.includes(needle)).map(([id]) => id);

const ICONS = "packages/web/src/components/ui/icons.tsx";
const CHEVRON = "packages/web/src/components/ui/chevron.tsx";
const GLYPH_ICON = "packages/web/src/components/ui/glyph-icon.tsx";

describe("icon scale", () => {
  it("scans every source root, and finds the icon modules in one place each", () => {
    expectEveryRootScanned(SCAN);
    for (const id of [ICONS, CHEVRON, GLYPH_ICON, "packages/web/src/lib/icon-scale.ts"]) {
      expectSingleHome(SCAN, id);
    }
  });

  it("names every rung with a whole pixel value", () => {
    for (const [role, size] of Object.entries(ICON_SIZE)) {
      expect(Number.isInteger(size), `${role} must be a whole pixel`).toBe(true);
      expect(size).toBeGreaterThan(8);
      expect(size).toBeLessThan(33);
    }
  });

  it("keeps the gap rungs in ascending order, as the text sizes they track are", () => {
    expect(Object.values(ICON_GAP)).toEqual(["gap-1", "gap-1.5", "gap-2", "gap-3"]);
  });
});

describe("one glyph, one home", () => {
  it("draws the form-control caret in exactly one place", () => {
    expect(occurrences("M3 4.5l3 3 3-3")).toEqual([ICONS]);
  });

  it("draws the close cross in exactly one place", () => {
    expect(occurrences("M2 2l10 10M12 2L2 12")).toEqual([ICONS]);
  });

  it("draws the collapse chevron in exactly one place", () => {
    expect(occurrences("M9 5l7 7-7 7")).toEqual([CHEVRON]);
  });

  // The two dock edges are drawn from two places at once — the chat toolbar's pull-open
  // buttons and the dock header's move-dock buttons — which is exactly how the marks above
  // accumulated their copies.
  it("draws the bottom-dock mark in exactly one place", () => {
    expect(occurrences("M4 5h16v14H4zM4 14h16")).toEqual([ICONS]);
  });

  it("draws the right-dock mark in exactly one place", () => {
    expect(occurrences("M4 5h16v14H4zM14 5v14")).toEqual([ICONS]);
  });

  it("draws the memory brain in exactly one place", () => {
    // The Memory mark was hand-typed three times — the dock's panel table, the memory-changes
    // card and the agent card's memory count — so a redraw moved one surface and left the others
    // on the old picture.
    expect(occurrences("M5.15 8.05C5.05 9.75")).toEqual([ICONS]);
  });

  it("draws the background-task trace in exactly one place", () => {
    // Three surfaces draw it now — a session row, the chat header pill and a backgrounded
    // tool row — which is how the paths above ended up hand-typed five times each.
    expect(occurrences("M2 12h4l3 9 6-18 3 9h4")).toEqual([ICONS]);
  });
});

describe("stroke weights", () => {
  it("uses no literal weight outside the ones the family actually chose", () => {
    // 1.7 is the 24x24 line family; 1.5 belongs to the two marks drawn on their own smaller
    // grids (the caret and the close cross) and to chart rules; 2 is the checkmark, the ring
    // gauges and the send arrow on a filled button; 2.2 is the collapse chevron alone; 1 is the
    // login background art. Anything else — a 1.6 or a 1.8 — is a glyph nobody sized on purpose.
    // A theme's lighter or heavier line family (1.6, 1.4) is never a literal: it is the
    // `--ui-icon-stroke` token below, which GlyphIcon reads.
    const allowed = new Set(["1", "1.5", "1.7", "2", "2.2"]);
    const strays: string[] = [];
    for (const [id, src] of FILES) {
      for (const m of src.matchAll(/strokeWidth="([0-9.]+)"/g)) {
        if (!allowed.has(m[1] ?? "")) strays.push(`${id}: ${m[1]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("draws the line family at the theme's stroke token, not at a literal", () => {
    const glyph = sourceFile(SCAN, GLYPH_ICON).text;
    expect(glyph).toContain('strokeWidth: "var(--ui-icon-stroke, 1.7)"');
    // The fallback is the default theme's weight; a literal attribute beside it would be dead code
    // that reads as the real weight.
    expect(glyph).not.toMatch(/strokeWidth="[0-9.]+"/);
  });

  describe("the --ui-icon-stroke token", () => {
    /** The weights a theme's line family may take: Primer 1.7, Frost 1.6, Console 1.4. */
    const LINE_FAMILY = new Set(["1.4", "1.6", "1.7"]);
    const themePath = (id: string) => new URL(`../../ui/src/themes/${id}.css`, import.meta.url);
    const analysis = (id: (typeof THEME_IDS)[number]) => {
      const path = themePath(id);
      if (!existsSync(path)) return null;
      const result = analyzeThemeFile(readFileSync(path, "utf8"), id);
      return result.isStub ? null : result;
    };
    const defaultTheme = analysis(DEFAULT_THEME_ID);

    for (const id of THEME_IDS) {
      const theme = analysis(id);
      if (theme === null || defaultTheme === null) {
        it.skip(`${id} — PENDING: themes/${id}.css declares no tokens yet`, () => {});
        continue;
      }
      it(`${id} sets a line-family weight in both modes`, () => {
        for (const mode of THEME_MODES) {
          const weight = resolveThemeValue("--ui-icon-stroke", mode, theme, defaultTheme);
          expect(LINE_FAMILY, `${id} ${mode}: --ui-icon-stroke = ${weight}`).toContain(weight);
        }
      });
    }

    if (defaultTheme !== null) {
      it("keeps the default theme at the weight GlyphIcon falls back to", () => {
        for (const mode of THEME_MODES) {
          expect(resolveThemeValue("--ui-icon-stroke", mode, defaultTheme, defaultTheme)).toBe(
            "1.7",
          );
        }
      });
    }
  });
});
