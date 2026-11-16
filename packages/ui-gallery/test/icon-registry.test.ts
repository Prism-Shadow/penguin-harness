import { describe, expect, it } from "vitest";
import { extractIconPaths, extractIconSizes } from "../src/lib/icon-registry";

describe("extractIconPaths", () => {
  it("reads constants, object entries, template fragments and cross-file references", () => {
    const icons = extractIconPaths({
      "a.tsx": `
        /** A doc comment mentioning label: "M0 0" that must not count. */
        const EYE = "M2 12s3-7 10-7 10 7 10 7";
        export const HIDDEN_ICON = \`\${EYE}M3 3l18 18\`;
        export const TRASH_ICON =
          "M4 6h16M9 6V4";
        export const LABEL = "Delete"; // not path data
        export const URL = "https://example.invalid/M1"; // not path data either
      `,
      "b.ts": `
        import { TRASH_ICON } from "./a";
        export const NAV_ICONS = {
          /** the bin */
          bin: TRASH_ICON,
          usage: "M4 20V10m6 10V4",
          nested: HIDDEN_ICON
        } as const;
        export const ICON_SIZE = { row: 12 };
      `,
    });
    const byName = (name: string) => icons.find((icon) => icon.names.includes(name));
    expect(byName("HIDDEN_ICON")?.d).toBe("M2 12s3-7 10-7 10 7 10 7M3 3l18 18");
    expect(byName("TRASH_ICON")?.names).toEqual(["TRASH_ICON", "NAV_ICONS.bin"]);
    expect(byName("TRASH_ICON")?.sources).toEqual(["a.tsx", "b.ts"]);
    expect(byName("NAV_ICONS.usage")?.d).toBe("M4 20V10m6 10V4");
    expect(byName("NAV_ICONS.nested")).toBe(byName("HIDDEN_ICON"));
    expect(icons.flatMap((icon) => icon.names)).not.toContain("LABEL");
    expect(icons.flatMap((icon) => icon.names)).not.toContain("URL");
  });

  it("skips an unresolved or circular reference instead of throwing", () => {
    const icons = extractIconPaths({
      "c.ts": `const A = B;\nconst B = A;\nconst C = \`\${MISSING}M1 1\`;\nconst D = "M0 0h1";`,
    });
    expect(icons.map((icon) => icon.names)).toEqual([["D"]]);
  });

  it("reads the icon scale's rungs, and nothing from a file without one", () => {
    const scale = `
      /** A doc comment: rowMark: 99 must not count. */
      export const ICON_SIZE = { rowMark: 12, inlineGlyph: 13.5 } as const;
    `;
    expect(extractIconSizes(scale)).toEqual([
      { name: "rowMark", px: 12 },
      { name: "inlineGlyph", px: 13.5 },
    ]);
    expect(extractIconSizes("export const OTHER = { a: 1 };")).toEqual([]);
  });
});
