/**
 * The cascade layers the themes stand on, in the order theme.css names them: `ui-base` (the
 * foundation and the base pack, Frost), `ui-theme` (every other pack), `ui-accent` (the presets),
 * `ui-font` (the user's font pairing).
 *
 * A layer's place is fixed where the sheet first names it, and a later `@layer a, b;` cannot move
 * one a block already opened. A stylesheet theme.css imported once opened `ui-theme` before the
 * order statement, which put Frost's base above every pack on every page while each file still
 * read correctly on its own. So:
 *
 * - theme.css names the four layers, in order, before anything it imports;
 * - no stylesheet under src/ but theme.css opens `ui-base` or `ui-theme`, and only a pack's
 *   index.css serves a file into one;
 * - the built sheet (`dist/styles.css`, what the package publishes and the Web App's bundle
 *   mirrors) names the four first in that order.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_LAYERS, scanSourceRoots, stripCssComments, unscannedRoots } from "../src/testing";
import { PACKAGE_DIR, REPO_ROOT, SRC_DIR } from "./helpers/paths";

/**
 * Every layer a sheet names, in the order it first names each: a statement (`@layer a, b;`), a
 * block (`@layer a {`) and an import into a layer (`@import "x.css" layer(a)`) all count.
 */
function layerMentions(css: string): string[] {
  const seen: string[] = [];
  const mention = /@layer\s+([^{;]+)[{;]|@import\s[^;]*?\blayer\(\s*([\w.-]+)\s*\)/g;
  for (const match of stripCssComments(css).matchAll(mention)) {
    const names = match[1] !== undefined ? match[1].split(",") : [match[2]!];
    for (const name of names.map((n) => n.trim())) {
      if (name !== "" && !seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

const ui = (names: readonly string[]) => names.filter((name) => name.startsWith("ui-"));

describe("the theme layers", () => {
  it("are named by theme.css, in cascade order, before anything it imports", () => {
    const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));
    const statement = sheet.search(/@layer\s+ui-base\s*,/);
    const firstImport = sheet.search(/@import\b/);
    expect(statement, "theme.css names its layers in one statement").toBeGreaterThanOrEqual(0);
    expect(statement, "the statement comes before theme.css's first @import").toBeLessThan(
      firstImport,
    );
    expect(ui(layerMentions(sheet))).toEqual([...UI_LAYERS]);
  });

  it("are recognised wherever a sheet names one — the check is exercised on known shapes", () => {
    expect(
      layerMentions(
        [
          "/* @layer ui-font; */",
          '@import "./a.css" layer(ui-theme);',
          "@layer ui-base, ui-theme;",
          "@layer ui-accent { .a { color: red } }",
          "@layer base{.b{color:red}}",
        ].join("\n"),
      ),
    ).toEqual(["ui-theme", "ui-base", "ui-accent", "base"]);
  });

  it("are opened outside theme.css only by a pack's index.css, for the files it serves", () => {
    const scan = scanSourceRoots({ ui: SRC_DIR }, { repoRoot: REPO_ROOT, extensions: [".css"] });
    expect(unscannedRoots(scan)).toEqual([]);
    const strays = scan.files
      .filter((file) => file.rel !== "theme.css")
      .flatMap((file) => {
        const opened = ui(layerMentions(file.text)).filter(
          (name) => name === "ui-base" || name === "ui-theme",
        );
        const servesPack = /^themes\/[^/]+\/index\.css$/.test(file.rel);
        const blocks = /@layer\s+ui-(?:base|theme)\b/.test(stripCssComments(file.text));
        return opened.length > 0 && (!servesPack || blocks)
          ? [`${file.rel}: ${opened.join(", ")}`]
          : [];
      });
    expect(
      strays,
      "Only theme.css opens ui-base and ui-theme; a pack serves its files into them from its " +
        "index.css with `@import … layer(…)`.",
    ).toEqual([]);
  });

  it("open in cascade order in the built sheet", () => {
    const built = join(PACKAGE_DIR, "dist", "styles.css");
    expect(
      existsSync(built),
      "dist/styles.css is missing — run `pnpm --filter @prismshadow/penguin-ui build` first",
    ).toBe(true);
    expect(ui(layerMentions(readFileSync(built, "utf8")))).toEqual([...UI_LAYERS]);
  });
});
