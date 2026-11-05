/**
 * Doodle's drawn line (`themes/cartoon.css` and its partials under `themes/cartoon/`).
 *
 * - The images and clips in the theme are the ones `scripts/draw-doodle-edges.mjs` draws: the
 *   line is seeded and never edited by hand, so a stroke and its clip cannot drift apart.
 * - Every drawn image, clip and mark a recipe reads is one the script draws — a misspelt
 *   `var(--_stroke-…)` would leave a box with no line and nothing on screen to say why.
 * - No filter runs anywhere in the theme but on a chart: a shadow is drawn into a floating
 *   slip's own image, because a `filter` on the composer cost as much raster as the whole
 *   transcript's lines.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCssRules, readThemeSources } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const SCRIPT = join(SRC_DIR, "..", "scripts", "draw-doodle-edges.mjs");
const SOURCES = readThemeSources(join(SRC_DIR, "themes"), "cartoon");
const RULES = SOURCES.flatMap((source) =>
  parseCssRules(source.css).map((rule) => ({ rule, file: source.file })),
);

/** The drawn things a recipe may read: strokes, clips, glass, marks and rules. */
const DRAWN = /^--_(?:stroke|clip|glass|mark|rule)-[\w-]+$/;

describe("Doodle's drawn line", () => {
  it("is in the theme as the script draws it", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("reads only images and clips the script draws, in both modes", () => {
    const declared = { light: new Set<string>(), dark: new Set<string>() };
    for (const { rule } of RULES) {
      const mode = rule.selector === ':root[data-theme="cartoon"].dark' ? "dark" : "light";
      for (const declaration of rule.declarations) {
        if (DRAWN.test(declaration.name)) declared[mode].add(declaration.name);
      }
    }
    // Clips are shapes, the same in both modes; every image has a dark twin.
    const images = [...declared.light].filter((name) => !name.startsWith("--_clip-"));
    expect(images.filter((name) => !declared.dark.has(name))).toEqual([]);
    const unknown = RULES.flatMap(({ rule, file }) =>
      rule.declarations.flatMap((declaration) =>
        [...declaration.value.matchAll(/var\(\s*(--_[\w-]+)/g)]
          .map((match) => match[1]!)
          .filter((name) => DRAWN.test(name) && !declared.light.has(name))
          .map((name) => `${file}:${declaration.line} ${rule.selector} reads ${name}`),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("runs no filter outside a chart's own paths", () => {
    const filtered = RULES.flatMap(({ rule, file }) =>
      rule.declarations
        .filter(
          (declaration) =>
            /^(?:-webkit-)?filter$/.test(declaration.name) && declaration.value !== "none",
        )
        .filter(() => !/\.ui-chart\b/.test([...rule.parents, rule.selector].join(" ")))
        .map((declaration) => `${file}:${declaration.line} ${rule.selector} { filter }`),
    );
    expect(filtered).toEqual([]);
  });
});
