/**
 * What the Web App's Tailwind build reads from this package.
 *
 * `packages/web/src/styles.css` points Tailwind at `packages/ui/src` — the package's components
 * carry class strings the app ships — and then excludes what only the gallery renders. That
 * `@source not` list is the only thing keeping the module compositions, the screen mock-ups, the
 * fixtures and the test helpers out of the app's stylesheet, so every directory in the package is
 * classified here: one the app ships from, or one the app excludes. A new directory fails this
 * suite until it is named on one of the two lists.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_DIR, WEB_DIR } from "./helpers/paths";

/** Directories whose class names belong in the app's sheet. */
const SHIPPED = ["components", "fonts", "themes"];

/** Directories only the gallery renders from; their class names must never reach the app. */
const GALLERY_ONLY = ["fixtures", "modules", "screens", "testing"];

const styles = readFileSync(join(WEB_DIR, "src", "styles.css"), "utf8");
const sources = [...styles.matchAll(/^@source\s+(not\s+)?"([^"]+)";/gm)].map((m) => ({
  excluded: m[1] !== undefined,
  path: m[2]!,
}));

describe("the app's Tailwind sources", () => {
  it("read the package's source root", () => {
    expect(sources.filter((s) => !s.excluded).map((s) => s.path)).toEqual(["../../ui/src"]);
  });

  it("exclude every directory only the gallery renders, and nothing the app ships", () => {
    const excluded = sources.filter((s) => s.excluded).map((s) => s.path);
    expect(excluded).toContain("../../ui/src/**/*.demo.tsx");
    for (const dir of GALLERY_ONLY) {
      expect(excluded, `${dir} is gallery-only`).toContain(`../../ui/src/${dir}`);
    }
    for (const dir of SHIPPED) {
      expect(excluded, `${dir} ships with the app`).not.toContain(`../../ui/src/${dir}`);
    }
  });

  it("classify every directory the package has", () => {
    const dirs = readdirSync(SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(
      dirs,
      "A new directory under packages/ui/src is either shipped with the app or excluded from its " +
        "Tailwind sources: add it to SHIPPED or to GALLERY_ONLY (and to styles.css's @source not).",
    ).toEqual([...SHIPPED, ...GALLERY_ONLY].sort());
  });
});
