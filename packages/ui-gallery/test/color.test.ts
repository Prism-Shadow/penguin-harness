import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS } from "@prismshadow/penguin-ui";
import { composite, contrastRatio, parseCssColor, toHex, wcagGrade } from "../src/lib/color";
import { parseAccentPresets } from "../src/foundations/color";

describe("colour maths", () => {
  it("parses hex and rgb() in both syntaxes", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#0d0d0d")).toEqual({ r: 13, g: 13, b: 13, a: 1 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(128 / 255);
    expect(parseCssColor("rgb(0 0 0 / 0.45)")).toEqual({ r: 0, g: 0, b: 0, a: 0.45 });
    expect(parseCssColor("rgba(37, 99, 235, 0.12)")).toEqual({ r: 37, g: 99, b: 235, a: 0.12 });
    expect(parseCssColor("transparent")?.a).toBe(0);
    expect(parseCssColor("oklch(50% 0.1 20)")).toBeNull();
  });

  it("computes WCAG ratios", () => {
    const white = parseCssColor("#ffffff")!;
    const black = parseCssColor("#000000")!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    // Tailwind gray-500 on white: the app's muted text.
    expect(contrastRatio(parseCssColor("#6a7282")!, white)).toBeCloseTo(4.83, 1);
    expect(wcagGrade(7.1)).toBe("AAA");
    expect(wcagGrade(4.5)).toBe("AA");
    expect(wcagGrade(3.2)).toBe("AA large");
    expect(wcagGrade(2.9)).toBe("fail");
  });

  it("composites a translucent ink over its backdrop", () => {
    const mixed = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(toHex(mixed)).toBe("#808080");
    expect(toHex({ r: 17, g: 24, b: 39, a: 0.5 })).toBe("#11182780");
  });
});

describe("the accent presets the Colour board draws", () => {
  const themeCss = readFileSync(
    fileURLToPath(new URL("../../ui/src/theme.css", import.meta.url)),
    "utf8",
  );

  it("are read whole out of theme.css, six values each", () => {
    const styles = parseAccentPresets(themeCss);
    expect(Object.keys(styles)).toEqual([...ACCENT_PRESETS]);
    for (const preset of ACCENT_PRESETS) {
      expect(Object.keys(styles[preset]!).sort(), preset).toEqual([
        "--ui-accent",
        "--ui-accent-active",
        "--ui-accent-fg",
        "--ui-accent-hover",
        "--ui-accent-line",
        "--ui-accent-muted",
      ]);
      expect(parseCssColor(String(styles[preset]!["--ui-accent" as never])), preset).not.toBeNull();
    }
  });

  it("fail loudly on a block that is missing or half read, never on a fallback colour", () => {
    expect(() => parseAccentPresets("")).toThrow(/no \[data-accent="blue"\] block/);
    const partial = themeCss.replace("--ui-accent-fg: #ffffff;", "");
    expect(() => parseAccentPresets(partial)).toThrow(/declares no --ui-accent-fg/);
  });
});
