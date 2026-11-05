/**
 * The font readout: the family a stack actually renders in, resolved over a probe of what the
 * document bundles and what the platform has, and the line the chrome prints.
 */
import { describe, expect, it } from "vitest";
import {
  faceInUse,
  familiesOf,
  FONT_ROLES,
  formatFontReadout,
  isGenericFamily,
} from "../src/app/fonts";
import type { Declared, FaceProbe } from "../src/app/fonts";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

/** A document that bundles `bundled`, has given up on `failed`, on a platform that has `installed`. */
function probe(
  bundled: readonly string[],
  installed: readonly string[],
  failed: readonly string[] = [],
): FaceProbe {
  const declared = (family: string): Declared =>
    bundled.includes(family) ? "bundled" : failed.includes(family) ? "failed" : "absent";
  return { declared, installed: (family) => installed.includes(family) };
}

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

  it("knows the generic keywords and the system aliases", () => {
    for (const family of ["system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"])
      expect(isGenericFamily(family)).toBe(true);
    expect(isGenericFamily("PingFang SC")).toBe(false);
  });

  it("names a bundled face, wherever it sits in the stack", () => {
    const linux = probe(["MiSans", "Mona Sans Variable"], ["Noto Sans CJK SC"]);
    expect(faceInUse(`"Mona Sans Variable", system-ui`, linux)).toBe("Mona Sans Variable");
    // The first family is not installed here: the readout does not claim it.
    expect(faceInUse(`"PingFang SC", "MiSans", sans-serif`, linux)).toBe("MiSans");
  });

  it("names an installed platform face when nothing before it can render", () => {
    const linux = probe([], ["Noto Sans CJK SC"]);
    expect(
      faceInUse(`"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`, linux),
    ).toBe("Noto Sans CJK SC");
  });

  it("says the platform only when the stack falls through to it", () => {
    const linux = probe([], []);
    expect(faceInUse("system-ui, -apple-system, sans-serif", linux)).toBeNull();
    expect(faceInUse(`"PingFang SC", "Microsoft YaHei", sans-serif`, linux)).toBeNull();
    expect(faceInUse(`"PingFang SC"`, linux)).toBeNull();
    expect(faceInUse("", linux)).toBeNull();
    // A generic keyword ahead of a bundled face means the platform renders, not the bundle.
    expect(faceInUse(`system-ui, "MiSans"`, probe(["MiSans"], []))).toBeNull();
  });

  it("skips a bundled face whose every slice failed to load", () => {
    const broken = probe(["MiSans"], ["Noto Sans CJK SC"], ["Mona Sans Variable"]);
    expect(faceInUse(`"Mona Sans Variable", "Noto Sans CJK SC", sans-serif`, broken)).toBe(
      "Noto Sans CJK SC",
    );
  });

  it("prints the three roles and the size in the chrome's language, the platform in words", () => {
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
    const platform = { latin: null, cjk: null, mono: null, px: 15 };
    expect(formatFontReadout(platform, en.readout)).toBe(
      "Latin System · CJK System · Mono System · 15px",
    );
    expect(formatFontReadout(platform, zh.readout)).toBe(
      "英文 系统 · 中文 系统 · 等宽 系统 · 15px",
    );
  });
});
