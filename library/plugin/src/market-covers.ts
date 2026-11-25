/**
 * The plugin market's covers that ship inside this build: each built-in plugin's `cover.webp` and
 * `cover-640.webp`, under `market-covers/<plugin>/`, copied from the community repository at
 * release preparation (scripts/sync-market-assets.mjs). The picture route answers a path the
 * embedded document names from here first, so the built-in plugins show their real covers from
 * the first second: offline, before any fetch, and with the published document off. Screenshots
 * do not ship; they are fetched and kept (market-pictures.ts).
 *
 * Every build puts the folder beside the module that reads it, this one (scripts/market-covers.mjs
 * says how): `src/plugin/` in a run from source, `dist/` in the npm package, the desktop app's
 * `dist/` beside its server bundle. A hot-pushed platform carries it among its assets instead.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginPlatformPorts } from "./ports.js";
import { asPicture } from "./market-pictures.js";
import type { MarketPicture } from "./market-pictures.js";

/** The folder's name, the same beside every bundle and among a push's assets. */
export const MARKET_COVERS_NAME = "market-covers";

/**
 * Where this build's covers are: a pushed platform's own (hmr.assetsDir(); scripts/deploy.mjs packs
 * them), else the folder beside this module. Null when neither holds it, as on a push made before
 * covers travelled with it: every picture is then fetched as before.
 */
export function bundledCoversDir(
  assets: string | null,
  here: string = path.dirname(fileURLToPath(import.meta.url)),
): string | null {
  const candidates = [
    ...(assets !== null ? [path.join(pluginPlatformPorts().unpackedAssetsDir(assets), MARKET_COVERS_NAME)] : []),
    path.join(here, MARKET_COVERS_NAME),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/**
 * The shipped picture at a document path (`<plugin>/cover.webp`), or null when this build has
 * none there. Read through the same check a fetched picture goes through, and never outside the
 * folder, whatever the path says.
 */
export async function readBundledPicture(
  dir: string,
  picturePath: string,
): Promise<MarketPicture | null> {
  const root = path.resolve(dir);
  const file = path.resolve(root, ...picturePath.split("/"));
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return asPicture(new Uint8Array(await fs.readFile(file)));
  } catch {
    return null;
  }
}
