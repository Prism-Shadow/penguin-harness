// @vitest-environment jsdom
/**
 * The accent dots Settings → Appearance paints (state/theme.tsx's accentSwatches), read from the
 * built-in packs' manifests.
 *
 * - Given Doodle in dark, the ink preset's dot is the pack's dark ink, so it shows on a dark row.
 * - Given Doodle in light, the ink preset's dot is the preset's own value.
 * - Given either mode, a hue preset's dot is the preset's own value.
 */
import { describe, expect, it } from "vitest";
import { accentSwatches } from "../src/state/theme";
import { themeEntries, type ThemeEntry } from "../src/state/theme-entries";

function doodle(): ThemeEntry {
  const entry = themeEntries([]).find((candidate) => candidate.id === "doodle");
  if (!entry) throw new Error("the build ships no Doodle pack");
  return entry;
}

function dot(theme: ThemeEntry, dark: boolean, preset: string): string | undefined {
  return accentSwatches(theme, dark).find((swatch) => swatch.value === preset)?.color;
}

function presetSwatch(theme: ThemeEntry, preset: string): string | undefined {
  return theme.accent.presets.find((candidate) => candidate.id === preset)?.swatch;
}

describe("the accent dots Settings paints", () => {
  it("paints Doodle's ink preset in the pack's dark ink in dark mode", () => {
    const theme = doodle();
    expect(dot(theme, true, "ink")).toBe(theme.swatches.dark.ink);
    expect(dot(theme, true, "ink")).not.toBe(presetSwatch(theme, "ink"));
  });

  it("paints Doodle's ink preset in its own value in light mode", () => {
    const theme = doodle();
    expect(dot(theme, false, "ink")).toBe(presetSwatch(theme, "ink"));
  });

  it("paints a hue preset in its own value in both modes", () => {
    const theme = doodle();
    expect(dot(theme, false, "marker")).toBe(presetSwatch(theme, "marker"));
    expect(dot(theme, true, "marker")).toBe(presetSwatch(theme, "marker"));
  });
});
