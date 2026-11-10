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
 * - each entry sheet that compiles the themes — the Web App's, the gallery's and the published
 *   `styles.css`'s — names the four first in that order once every `@import` is followed the way
 *   the compiler inlines it. (`scripts/check-ui-package.mjs` reads the built `dist/styles.css`
 *   for the same order.)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_LAYERS, scanSourceRoots, stripCssComments, unscannedRoots } from "../src/testing";
import { PACKAGE_DIR, REPO_ROOT, SRC_DIR, WEB_DIR } from "./helpers/paths";

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

/** The package's own stylesheet specifiers (`exports`), as a consumer's import names them. */
const PACKAGE_STYLES: readonly (readonly [prefix: string, dir: string])[] = [
  ["@prismshadow/penguin-ui/theme.css", join(SRC_DIR, "theme.css")],
  ["@prismshadow/penguin-ui/fonts.css", join(SRC_DIR, "fonts", "index.css")],
  ["@prismshadow/penguin-ui/themes/", join(SRC_DIR, "themes") + "/"],
];

/** Where an `@import` lands, or null for a stylesheet outside the package (Tailwind, fontsource). */
function resolveImport(specifier: string, from: string): string | null {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  for (const [prefix, target] of PACKAGE_STYLES) {
    if (specifier === prefix) return target;
    if (prefix.endsWith("/") && specifier.startsWith(prefix)) {
      return target + specifier.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Every layer a sheet names, in the order the compiled sheet first names each, following its
 * imports the way the compiler inlines them: an import into a layer names that layer where it
 * stands, then the imported sheet's own mentions follow in place.
 */
function layerOrderThrough(
  entry: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string[] {
  const seen: string[] = [];
  const name = (layer: string) => {
    if (layer !== "" && !seen.includes(layer)) seen.push(layer);
  };
  const event = /@import\s+["']([^"']+)["']([^;]*);|@layer\s+([^{;]+)[{;]/g;
  const walk = (path: string, depth: number) => {
    if (depth > 16) throw new Error(`${path}: imports nest deeper than 16`);
    for (const match of stripCssComments(read(path)).matchAll(event)) {
      if (match[3] !== undefined) {
        for (const layer of match[3].split(",")) name(layer.trim());
        continue;
      }
      const into = /\blayer\(\s*([\w.-]+)\s*\)/.exec(match[2]!)?.[1];
      if (into !== undefined) name(into);
      const target = resolveImport(match[1]!, path);
      if (target !== null) walk(target, depth + 1);
    }
  };
  walk(entry, 0);
  return seen;
}

/** The entry sheets that compile the theme packs into one stylesheet each. */
const GALLERY_STYLES = join(REPO_ROOT, "packages", "ui-gallery", "src", "styles.css");
const ENTRIES: Readonly<Record<string, string>> = {
  web: join(WEB_DIR, "src", "styles.css"),
  published: join(PACKAGE_DIR, "scripts", "styles.entry.css"),
  ...(existsSync(GALLERY_STYLES) ? { gallery: GALLERY_STYLES } : {}),
};

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

  it("are named in the order the imports put them — the walk is exercised on the trap it guards", () => {
    // A foundation sheet imported ahead of the statement opens ui-theme first, and the statement
    // can no longer put ui-base under it.
    // Keyed by resolved path, so the walk finds them on any platform's path syntax.
    const at = (file: string) => resolve("/x", file);
    const files: Record<string, string> = {
      [at("entry.css")]:
        '@import "tailwindcss";\n@import "./theme.css";\n@import "./pack/index.css";',
      [at("theme.css")]: '@import "./early.css";\n@layer ui-base, ui-theme, ui-accent, ui-font;',
      [at("early.css")]: "@layer ui-theme { .a { color: red } }",
      [at("pack/index.css")]: '@import "./tokens.css" layer(ui-base);',
      [at("pack/tokens.css")]: ":root { --ui-canvas: #fff; }",
    };
    const read = (path: string) => files[path] ?? "";
    expect(ui(layerOrderThrough(at("entry.css"), read))).toEqual([
      "ui-theme",
      "ui-base",
      "ui-accent",
      "ui-font",
    ]);
    files[at("theme.css")] =
      '@layer ui-base, ui-theme, ui-accent, ui-font;\n@import "./early.css";';
    expect(ui(layerOrderThrough(at("entry.css"), read))).toEqual([...UI_LAYERS]);
  });

  for (const [name, entry] of Object.entries(ENTRIES)) {
    it(`${name}: names the four layers first in cascade order, through every import`, () => {
      expect(ui(layerOrderThrough(entry))).toEqual([...UI_LAYERS]);
    });
  }
});
