/**
 * The plugin market's covers that ship inside the build: each built-in plugin's `cover.webp` and
 * `cover-640.webp`, as the community repository's `assets/plugins/<plugin>/` has them, so every
 * reader sees the real covers from the first second, offline included. Screenshots do not ship;
 * the server fetches and keeps those (packages/server/src/plugin/market-pictures.ts).
 *
 * The files live in the server's source tree, `packages/server/src/plugin/market-covers/`, which
 * is where a run from source finds them: beside the module that reads them
 * (packages/server/src/plugin/market-covers.ts). Every other build has to put the same folder
 * beside its bundle, as the far-side scripts are (scripts/far-side-scripts.mjs):
 * packages/server/tsup.config.ts copies it into dist/ (npm's `files: ["dist"]` ships it, and so
 * does the Docker image's `pnpm deploy`), packages/desktop/scripts/build-assets.mjs into the
 * desktop app's dist/ beside its one-file server bundle, and scripts/deploy.mjs packs it into the
 * hot push's assets (the platform reads it through hmr.assetsDir()). The folder's name is the
 * same in all four places. scripts/sync-market-assets.mjs refreshes it from the community
 * repository at release preparation.
 */
import fs from "node:fs";
import path from "node:path";

/** The folder's name beside every bundle. */
export const MARKET_COVERS_NAME = "market-covers";

/** Where the folder lives in the repository, relative to its root. */
export const MARKET_COVERS_SOURCE = "packages/server/src/plugin/market-covers";

/** Every file in the folder, as `<plugin>/<file>` paths, sorted; empty when it is missing. */
export function marketCoverFiles(repoRoot) {
  const root = path.join(repoRoot, MARKET_COVERS_SOURCE);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

/** Copies the folder to `<destDir>/market-covers/`, replacing what is there; throws when it is missing or empty. */
export function copyMarketCovers(repoRoot, destDir) {
  const files = marketCoverFiles(repoRoot);
  if (files.length === 0) {
    throw new Error(`${MARKET_COVERS_SOURCE} is missing or empty: the build would ship no covers`);
  }
  const dest = path.join(destDir, MARKET_COVERS_NAME);
  fs.rmSync(dest, { recursive: true, force: true });
  for (const rel of files) {
    const to = path.join(dest, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, MARKET_COVERS_SOURCE, ...rel.split("/")), to);
  }
  return files;
}
