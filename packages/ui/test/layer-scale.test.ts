/**
 * The layer scale holds: every z-index in the UI package, the Web App and the gallery names a
 * layer of `src/layers.css` (`src/testing/layers.ts` reads them).
 *
 * A number picked against the surfaces its author looked at is wrong for the ones they did not:
 * the order holds only while every z-index is spelled in one file and a component picks a layer
 * by what it is for.
 *
 * - Given the three source trees, no z-index is a raw number or an undeclared name, and no file
 *   needs to be exempted.
 * - Given a raw value planted in any form a z-index takes — a class, an arbitrary value, an inline
 *   style, a style write, a stylesheet declaration — or a layer the scale does not declare, the
 *   guard reports each one, with its file and line; a declared layer and `auto` pass.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  declaredLayers,
  layerHits,
  matchesPolicyPath,
  scanSourceRoots,
  unscannedRoots,
} from "../src/testing";
import type { SourceFile } from "../src/testing";
import { REPO_ROOT, SRC_DIR } from "./helpers/paths";

const LAYERS = declaredLayers(readFileSync(join(SRC_DIR, "layers.css"), "utf8"));

/** Files that keep a raw z-index, each with the reason. None does. */
const ALLOWLIST: Record<string, string> = {};

/** Test helpers are not application code: they spell `z-index` to look for it. */
const NOT_APP = ["testing/"];

const SCAN = scanSourceRoots(
  {
    ui: SRC_DIR,
    web: join(REPO_ROOT, "packages/web/src"),
    gallery: join(REPO_ROOT, "packages/ui-gallery/src"),
  },
  { repoRoot: REPO_ROOT },
);
const FILES = SCAN.files.filter((file) => !matchesPolicyPath(file.rel, NOT_APP));

/** A source file that exists only in this test. */
function planted(name: string, text: string): SourceFile {
  const rel = `planted/${name}`;
  return { root: "ui", rel, id: `packages/ui/src/${rel}`, path: `/planted/${name}`, name, text };
}

describe("the layer scale", () => {
  it("is the only place a z-index is a number in the three trees", () => {
    expect(unscannedRoots(SCAN)).toEqual([]);
    expect(LAYERS.size).toBeGreaterThan(0);
    const hits = layerHits(FILES, LAYERS, ALLOWLIST).map(
      (hit) => `${hit.file}:${hit.line} ${hit.problem}: ${hit.found}`,
    );
    expect(hits).toEqual([]);
  });

  it("reports a planted raw value in every form, and an undeclared layer", () => {
    const markup = planted(
      "panel.tsx",
      [
        'export const a = <div className="absolute z-10" />;',
        'export const b = <div className={`fixed ${open ? "z-[60]" : "md:-z-1"}`} />;',
        'export const c = <div style={{ zIndex: 5 }} className="md:[z-index:7]" />;',
        "export function d(el: HTMLElement) { el.style.zIndex = String(41); }",
        'export function e(el: HTMLElement) { el.style.setProperty("z-index", "3"); }',
        'export const f = <div className="z-sky" style={{ zIndex: layer("sky") }} />;',
        'export const ok = <div className="z-dock hover:z-auto" style={{ zIndex: layer("toast") }} />;',
      ].join("\n"),
    );
    const sheet = planted(
      "panel.css",
      [
        ".a { z-index: 40; }",
        ".b { z-index: var(--layer-sky); }",
        ".ok { z-index: var(--layer-modal); }",
        ".ok2 { z-index: auto; }",
      ].join("\n"),
    );
    const found = layerHits([markup, sheet], LAYERS).map(
      (hit) => `${hit.file.split("/").pop()}:${hit.line} ${hit.problem}: ${hit.found}`,
    );
    expect(found).toEqual([
      "panel.css:1 raw: z-index: 40",
      "panel.css:2 unknown layer: var(--layer-sky)",
      "panel.tsx:1 raw: z-10",
      "panel.tsx:2 raw: z-[60]",
      "panel.tsx:2 raw: md:-z-1",
      "panel.tsx:3 raw: md:[z-index:7]",
      "panel.tsx:3 raw: zIndex: 5",
      "panel.tsx:4 raw: el.style.zIndex = String(41)",
      'panel.tsx:5 raw: el.style.setProperty("z-index", "3")',
      "panel.tsx:6 unknown layer: z-sky",
      'panel.tsx:6 unknown layer: zIndex: layer("sky")',
    ]);
  });
});
