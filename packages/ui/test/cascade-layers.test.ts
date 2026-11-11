/**
 * The cascade layers the themes stand on, in the order theme.css names them: `ui-base` (the
 * foundation and the base pack, Frost), `ui-theme` (every other pack), `ui-accent` (the presets),
 * `ui-font` (the user's font pairing).
 *
 * A layer's place is fixed where the sheet first names it, and a later `@layer a, b;` cannot move
 * one a block already opened. A stylesheet theme.css imported once opened `ui-theme` before the
 * order statement, which put Frost's base above every pack on every page while each file still
 * read correctly on its own. So each entry sheet that compiles the themes — the Web App's, the
 * gallery's and the published `styles.css`'s — must name the four first in that order once every
 * `@import` is followed the way the compiler inlines it, wherever a stray layer opens. An import of
 * this package that its `exports` do not resolve fails the walk instead of leaving it blind.
 * (`scripts/check-ui-package.mjs` reads the built `dist/styles.css` for the same order.)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_LAYERS, stripCssComments } from "../src/testing";
import { PACKAGE_DIR, REPO_ROOT, WEB_DIR } from "./helpers/paths";

const ui = (names: readonly string[]) => names.filter((name) => name.startsWith("ui-"));

type ExportTarget = string | { readonly style?: string; readonly default?: string };
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
  readonly name: string;
  readonly exports: Readonly<Record<string, ExportTarget>>;
};

/**
 * The package's own specifiers, read from its `exports` as a consumer's import names them, each
 * with the file a stylesheet import of it gets (the `style` condition first). A `*` in a key
 * stands for any path under it, as in the manifest.
 */
const PACKAGE_STYLES: readonly (readonly [specifier: string, target: string])[] = Object.entries(
  MANIFEST.exports,
).flatMap(([key, value]) => {
  const target = typeof value === "string" ? value : (value.style ?? value.default);
  return target === undefined ? [] : [[MANIFEST.name + key.slice(1), target] as const];
});

/**
 * Where an `@import` lands, or null for a stylesheet of another package (Tailwind, fontsource).
 * An import of this package that no export resolves throws: skipping it would leave the walk
 * blind to every layer the file behind it names.
 */
function resolveImport(specifier: string, from: string): string | null {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  if (specifier !== MANIFEST.name && !specifier.startsWith(`${MANIFEST.name}/`)) return null;
  for (const [key, target] of PACKAGE_STYLES) {
    const star = key.indexOf("*");
    if (star < 0) {
      if (specifier === key) return resolve(PACKAGE_DIR, target);
      continue;
    }
    const [head, tail] = [key.slice(0, star), key.slice(star + 1)];
    if (specifier.startsWith(head) && specifier.endsWith(tail)) {
      const rest = specifier.slice(head.length, specifier.length - tail.length);
      return resolve(PACKAGE_DIR, target.replace("*", rest));
    }
  }
  throw new Error(`${from}: "${specifier}" is not among ${MANIFEST.name}'s exports`);
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
  it("are named in the order the imports put them — the walk is exercised on the trap it guards, and fails on an import it cannot follow", () => {
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
    files[at("pack/index.css")] = `@import "${MANIFEST.name}/no-such-export.css";`;
    expect(() => layerOrderThrough(at("entry.css"), read)).toThrow(/no-such-export\.css/);
  });

  for (const [name, entry] of Object.entries(ENTRIES)) {
    it(`${name}: names the four layers first in cascade order, through every import`, () => {
      expect(ui(layerOrderThrough(entry))).toEqual([...UI_LAYERS]);
    });
  }
});
