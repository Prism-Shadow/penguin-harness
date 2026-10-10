/**
 * The fonts page's defaults table prints what the package states for every theme, and names the
 * platform's face only where the package does.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { SYSTEM_FONT, THEME_FONTS } from "@prismshadow/penguin-ui/boot";
import { describe, expect, it } from "vitest";
import { isSystemFont, themeFontRows } from "../src/lib/theme-fonts";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("the theme fonts table", () => {
  it("has one row per theme, in the package's order, with the package's names", () => {
    const rows = themeFontRows();
    expect(rows.map((row) => row.theme)).toEqual([...THEME_IDS]);
    for (const row of rows) {
      expect(row.latin).toBe(THEME_FONTS[row.theme].latin);
      expect(row.cjk).toBe(THEME_FONTS[row.theme].cjk);
      expect(row.mono).toBe(THEME_FONTS[row.theme].mono);
      for (const name of [row.latin, row.cjk, row.mono]) expect(name.trim()).not.toBe("");
    }
  });

  it("tells the platform's face from a bundled one, and both dictionaries word it", () => {
    expect(isSystemFont(SYSTEM_FONT)).toBe(true);
    expect(isSystemFont("MiSans")).toBe(false);
    expect(zh.fonts.system.trim()).not.toBe("");
    expect(en.fonts.system.trim()).not.toBe("");
  });
});
