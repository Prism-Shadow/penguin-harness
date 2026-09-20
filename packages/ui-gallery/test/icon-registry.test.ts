import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIconPaths, extractIconSizes, unreadPaths } from "../src/lib/icon-registry";

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

  it("separates a spelled-out declaration from an alias pointing at it", () => {
    const icons = extractIconPaths({
      "a.ts": `
        export const TRASH_ICON = "M4 6h16M9 6V4";
        export const NAV_ICONS = { bin: TRASH_ICON, usage: "M4 20V10m6 10V4" };
        export const ALSO_TRASH = "M4 6h16M9 6V4";
      `,
    });
    const trash = icons.find((icon) => icon.names.includes("TRASH_ICON"));
    expect(trash?.names).toEqual(["TRASH_ICON", "ALSO_TRASH", "NAV_ICONS.bin"]);
    // The alias is a name, not a duplicate; the second spelled-out copy is.
    expect(trash?.declaredNames).toEqual(["TRASH_ICON", "ALSO_TRASH"]);
    expect(icons.find((icon) => icon.names.includes("NAV_ICONS.usage"))?.declaredNames).toEqual([
      "NAV_ICONS.usage",
    ]);
  });

  it("counts the paths no constant names, such as an icon drawn inline in JSX", () => {
    const sources = {
      "a.tsx": `
        export const TRASH_ICON = "M4 6h16M9 6V4";
        export function ChevronDown() {
          return <path d="M6 9l6 6 6-6" />;
        }
        export function Check() {
          return <path d="M20 6L9 17l-5-5" />;
        }
      `,
    };
    const icons = extractIconPaths(sources);
    expect(icons.map((icon) => icon.names)).toEqual([["TRASH_ICON"]]);
    expect(unreadPaths(sources, icons)).toBe(2);
    expect(
      unreadPaths(sources, [
        ...icons,
        { d: "M6 9l6 6 6-6", names: [], declaredNames: [], sources: [] },
      ]),
    ).toBe(1);
  });

  it("skips an unresolved or circular reference instead of throwing", () => {
    const icons = extractIconPaths({
      "c.ts": `const A = B;\nconst B = A;\nconst C = \`\${MISSING}M1 1\`;\nconst D = "M0 0h1";`,
    });
    expect(icons.map((icon) => icon.names)).toEqual([["D"]]);
  });

  it("finds the Web App's icons in the modules the gallery reads", () => {
    const read = (path: string) =>
      readFileSync(fileURLToPath(new URL(`../../web/src/${path}`, import.meta.url)), "utf8");
    const icons = extractIconPaths({
      icons: read("components/ui/icons.tsx"),
      groupList: read("components/ui/group-list.tsx"),
      rowMenu: read("components/ui/session-row-menu.tsx"),
      stat: read("lib/stat-icons.ts"),
    });
    const names = icons.flatMap((icon) => icon.names);
    expect(icons.length).toBeGreaterThan(30);
    for (const name of [
      "TRASH_ICON",
      "GEAR_ICON",
      "FOLDER_ICON",
      "STAT_ICONS.copy",
      "NAV_ICONS.models",
    ]) {
      expect(names).toContain(name);
    }
    const sizes = extractIconSizes(read("lib/icon-scale.ts"));
    expect(sizes.find((rung) => rung.name === "inlineGlyph")?.px).toBe(13);
  });
});
