/**
 * Guard: the icon family as the app uses it — the role-named scale, the registry and the
 * renderers, all in the shared UI package (`icon-scale.ts`, `components/icons/…`). A new inline
 * `<svg>` re-drawing a glyph the app already owns, at a stroke weight nobody chose, is what
 * decays, so these are source scans over the web app and the UI package.
 *
 * - The scan reads every source root and finds the icon modules in one place each; every icon
 *   rung is a whole pixel value in the legible range.
 * - Each shared glyph (the control caret, the close cross, the collapse chevron, the two dock
 *   marks, the memory brain, the background-task trace) is drawn in exactly one place.
 * - No literal stroke weight appears outside the ones the family chose.
 * - Every theme sets a line-family weight for `--ui-icon-stroke` in both modes, and the default
 *   theme keeps the weight GlyphIcon falls back to.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICON_SIZE } from "@prismshadow/penguin-ui";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_MODES } from "../../ui/src/tokens";
import { analyzeThemeFile, resolveThemeValue } from "../../ui/src/testing/theme-tokens";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";

const SCAN = scanSources();

// Every file id is repo-relative with forward slashes whatever the platform separator is, so the
// expected paths below read the same on Windows as they do everywhere else.
const FILES = SCAN.files
  .filter((file) => file.name.endsWith(".ts") || file.name.endsWith(".tsx"))
  .map((file) => [file.id, file.text] as const);

/** Every file containing `needle`, by repo-relative id. */
const occurrences = (needle: string) =>
  FILES.filter(([, src]) => src.includes(needle)).map(([id]) => id);

const REGISTRY = "packages/ui/src/components/icons/icons.ts";
const MARKS = "packages/ui/src/components/icons/marks/marks.tsx";
const CHEVRON = "packages/ui/src/components/icons/chevron/chevron.tsx";
const GLYPH_ICON = "packages/ui/src/components/icons/glyph-icon/glyph-icon.tsx";
const SCALE = "packages/ui/src/icon-scale.ts";

describe("icon scale", () => {
  it("scans every source root, and finds the icon modules in one place each", () => {
    expectEveryRootScanned(SCAN);
    // The marks file is left out: the chart primitives' `marks.tsx` shares its name.
    for (const id of [REGISTRY, CHEVRON, GLYPH_ICON, SCALE]) {
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
});

describe("one glyph, one home", () => {
  it("draws the form-control caret in exactly one place", () => {
    expect(occurrences("M3 4.5l3 3 3-3")).toEqual([MARKS]);
  });

  it("draws the close cross in exactly one place", () => {
    expect(occurrences("M2 2l10 10M12 2L2 12")).toEqual([MARKS]);
  });

  it("draws the collapse chevron in exactly one place", () => {
    expect(occurrences("M9 5l7 7-7 7")).toEqual([CHEVRON]);
  });

  // The two dock edges are drawn from two places at once — the chat toolbar's pull-open
  // buttons and the dock header's move-dock buttons — which is exactly how the marks above
  // accumulated their copies.
  it("draws the bottom-dock mark in exactly one place", () => {
    expect(occurrences("M4 5h16v14H4zM4 14h16")).toEqual([REGISTRY]);
  });

  it("draws the right-dock mark in exactly one place", () => {
    expect(occurrences("M4 5h16v14H4zM14 5v14")).toEqual([REGISTRY]);
  });

  it("draws the memory brain in exactly one place", () => {
    // The Memory mark was hand-typed three times — the dock's panel table, the memory-changes
    // card and the agent card's memory count — so a redraw moved one surface and left the others
    // on the old picture.
    expect(occurrences("M5.15 8.05C5.05 9.75")).toEqual([REGISTRY]);
  });

  it("draws the background-task trace in exactly one place", () => {
    // Three surfaces draw it now — a session row, the chat header pill and a backgrounded
    // tool row — which is how the paths above ended up hand-typed five times each.
    expect(occurrences("M2 12h4l3 9 6-18 3 9h4")).toEqual([REGISTRY]);
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
