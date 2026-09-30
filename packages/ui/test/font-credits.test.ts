/**
 * The credits list (src/fonts/credits.ts) against the licence mirror (src/fonts/LICENSES/).
 *
 * `font-licenses.test.ts` holds the mirror to the font packages; this suite holds the list a
 * Credits page renders to the mirror: every text credited exactly once, every credit's text the
 * file's own, every credit naming the licence its text carries, the vendored face's title and
 * source what `vendored-fonts.json` declares, and the themes a face is credited to the themes
 * whose stacks name it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_FONT_FAMILIES, THEME_FONTS } from "../src/boot";
import { FONT_CREDITS, MISANS_LICENSE_TITLE, MISANS_SOURCE } from "../src/fonts/credits";
import { THEME_IDS } from "../src/tokens";
import { SRC_DIR } from "./helpers/paths";

const LICENSES_DIR = join(SRC_DIR, "fonts", "LICENSES");

describe("FONT_CREDITS", () => {
  it("credits every licence in the mirror once, with the file's own text", () => {
    const files = readdirSync(LICENSES_DIR)
      .filter((name) => name.endsWith(".txt"))
      .map((name) => name.slice(0, -".txt".length))
      .sort();
    expect([...FONT_CREDITS.map((credit) => credit.id)].sort()).toEqual(files);
    for (const credit of FONT_CREDITS) {
      const text = readFileSync(join(LICENSES_DIR, `${credit.id}.txt`), "utf8");
      expect(credit.licenseText, credit.id).toBe(text);
    }
  });

  it("names the licence each text carries, and the vendored face's manifest values", () => {
    for (const credit of FONT_CREDITS) {
      expect(credit.licenseText, credit.id).toMatch(
        credit.id === "misans" ? credit.licenseTitle : /SIL Open Font License/i,
      );
      expect(credit.family).not.toBe("");
      expect(credit.source).not.toBe("");
    }
    const manifest = JSON.parse(
      readFileSync(join(SRC_DIR, "fonts", "vendored-fonts.json"), "utf8"),
    ) as Record<string, { licenseTitle: string; package: string; family: string }>;
    expect(MISANS_LICENSE_TITLE).toBe(manifest.misans!.licenseTitle);
    expect(MISANS_SOURCE).toBe(manifest.misans!.package);
    expect(FONT_CREDITS.find((credit) => credit.id === "misans")?.family).toBe(
      manifest.misans!.family,
    );
  });

  it("credits each face to the themes whose own faces name it, and every bundled face once", () => {
    const families = FONT_CREDITS.map((credit) => credit.family);
    expect(new Set(families).size).toBe(families.length);
    for (const family of Object.keys(BUNDLED_FONT_FAMILIES)) {
      const credit = FONT_CREDITS.find((entry) => entry.family === family);
      expect(credit, family).toBeDefined();
      expect([...credit!.themes]).toEqual(
        THEME_IDS.filter((id) => Object.values(THEME_FONTS[id]).includes(family)),
      );
    }
  });
});
