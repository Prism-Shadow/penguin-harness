/**
 * The built-in packs' sources a build carries, for the server's export of a built-in.
 *
 * - Given a pack folder, every file of it lands under `themes/<id>/`, and a folder without a
 *   pack.json is not a pack.
 * - Given a font the bundle already carries as a hashed asset, it is not copied again: the pack's
 *   fonts.json maps it to that asset. A font the bundle does not carry is copied under the pack and
 *   mapped there.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { themePackAssets } from "../src/vite-plugin";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "penguin-theme-sources-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

describe("themePackAssets", () => {
  it("emits each pack's files under themes/<id>/, and maps its fonts to the assets the bundle carries", () => {
    const root = project({
      "src/themes/sketch/pack.json": "{}",
      "src/themes/sketch/tokens.css": ":root{}",
      "src/themes/sketch/fonts/hand.woff2": "bundled",
      "src/themes/sketch/fonts/spare.woff2": "unreferenced",
      "src/themes/notes/README.md": "no manifest, no pack",
    });
    const bundle = {
      "assets/hand-AbC123.woff2": {
        type: "asset",
        fileName: "assets/hand-AbC123.woff2",
        originalFileNames: ["src/themes/sketch/fonts/hand.woff2"],
      },
      "index.js": { type: "chunk", fileName: "index.js" },
    };
    const assets = themePackAssets(root, bundle, join(root, "src/themes"));
    expect(assets.map((asset) => asset.fileName).sort()).toEqual([
      "themes/sketch/fonts.json",
      "themes/sketch/fonts/spare.woff2",
      "themes/sketch/pack.json",
      "themes/sketch/tokens.css",
    ]);
    const fonts = assets.find((asset) => asset.fileName === "themes/sketch/fonts.json")!;
    expect(JSON.parse(String(fonts.source))).toEqual({
      "fonts/hand.woff2": "assets/hand-AbC123.woff2",
      "fonts/spare.woff2": "themes/sketch/fonts/spare.woff2",
    });
  });
});
