/**
 * The font readout: the family a stack is set in, and the line the top bar prints.
 */
import { describe, expect, it } from "vitest";
import { familiesOf, firstFamily, FONT_ROLES, formatFontReadout } from "../src/app/fonts";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("the font readout", () => {
  it("reads the sans, CJK and mono tokens", () => {
    expect(FONT_ROLES).toEqual({
      latin: "--ui-font-sans",
      cjk: "--ui-font-cjk",
      mono: "--ui-font-mono",
    });
  });

  it("splits a stack into unquoted families, in order", () => {
    expect(familiesOf(`"Mona Sans Variable", "MiSans", system-ui, sans-serif`)).toEqual([
      "Mona Sans Variable",
      "MiSans",
      "system-ui",
      "sans-serif",
    ]);
    expect(familiesOf(" 'JetBrains Mono Variable' , monospace ")).toEqual([
      "JetBrains Mono Variable",
      "monospace",
    ]);
    expect(familiesOf("")).toEqual([]);
  });

  it("names the first family, or the platform when the stack defers to it", () => {
    expect(firstFamily(`"Mona Sans Variable", system-ui`)).toBe("Mona Sans Variable");
    expect(firstFamily("system-ui, -apple-system, sans-serif")).toBe("System");
    expect(firstFamily("ui-monospace, Menlo, monospace")).toBe("System mono");
    expect(firstFamily("")).toBe("—");
  });

  it("prints the three roles and the size in the chrome's language", () => {
    const readout = {
      latin: "Mona Sans Variable",
      cjk: "MiSans",
      mono: "JetBrains Mono Variable",
      px: 16,
    };
    expect(formatFontReadout(readout, en.readout)).toBe(
      "Latin Mona Sans Variable · CJK MiSans · Mono JetBrains Mono Variable · 16px",
    );
    expect(formatFontReadout(readout, zh.readout)).toBe(
      "英文 Mona Sans Variable · 中文 MiSans · 等宽 JetBrains Mono Variable · 16px",
    );
  });
});
