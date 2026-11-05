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
 * - A frame's fill, which follows the line by its corner rather than a clip, ends under the pen at
 *   every corner of the drawn outline, wherever the line wobbles there.
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

/** The drawn things a recipe may read: strokes, clips, fill corners, glass, marks and rules. */
const DRAWN = /^--_(?:stroke|clip|fill|glass|mark|rule)-[\w-]+$/;

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
    // Clips and fill corners are shapes, the same in both modes; every image has a dark twin.
    const images = [...declared.light].filter((name) => !/^--_(?:clip|fill)-/.test(name));
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

  it("ends a frame's fill under the pen at every corner, however the line wobbles there", () => {
    const geometry = JSON.parse(
      execFileSync(process.execPath, [SCRIPT, "--geometry"], { encoding: "utf8" }),
    ) as { size: number; slice: number; stroke: number; line: [number, number][]; radius: number };
    const { size, slice, stroke, line, radius } = geometry;
    // The fill's edge: a padding-box corner of `radius` under a 1px border, and its straight runs
    // out to the slice, at each corner of the outline's image.
    const quarter: [number, number][] = [];
    for (let deg = 180; deg <= 270; deg += 1) {
      const a = (deg * Math.PI) / 180;
      quarter.push([radius + (radius - 1) * Math.cos(a), radius + (radius - 1) * Math.sin(a)]);
    }
    for (let v = radius; v <= slice; v += 0.25) quarter.push([1, v], [v, 1]);
    const edge = [
      ...quarter,
      ...quarter.map(([x, y]) => [size - x, y]),
      ...quarter.map(([x, y]) => [size - x, size - y]),
      ...quarter.map(([x, y]) => [x, size - y]),
    ];
    const distance = ([px, py]: number[]) =>
      Math.min(
        ...line.map(([x0, y0], i) => {
          const [x1, y1] = line[(i + 1) % line.length]!;
          const [dx, dy] = [x1 - x0, y1 - y0];
          const t = Math.max(
            0,
            Math.min(1, ((px! - x0) * dx + (py! - y0) * dy) / (dx * dx + dy * dy)),
          );
          return Math.hypot(px! - x0 - t * dx, py! - y0 - t * dy);
        }),
      );
    const astray = edge.filter((point) => distance(point) > stroke / 2);
    expect(astray, `the fill's edge leaves the ${stroke}px pen at these points`).toEqual([]);
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
