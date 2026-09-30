/**
 * `penguinUi()` — the Vite plugin that ships the bundled fonts' licences.
 *
 * On a build it emits the licence texts in `src/fonts/LICENSES/*.txt` (mirrored from the font
 * packages by `scripts/sync-font-licenses.mjs`, and MiSans's transcribed from its licensor) as
 * `fonts-licenses/<name>.txt`, so every dist that carries the fonts — the served app, the desktop
 * bundle, the gallery — carries their licences beside them. Resolving the package needs no plugin:
 * a consumer's `workspace:*` dependency is linked to this directory.
 *
 * A vite config imports it by relative path (`../ui/src/vite-plugin`), which the config bundle
 * inlines; it is not one of the package's `exports`. Structural types only, so the package needs
 * no `vite` dependency.
 */
import { readFileSync, readdirSync } from "node:fs";

/** The slice of Rollup's plugin context the licence emission uses. */
export interface PenguinUiEmitContext {
  emitFile(file: { type: "asset"; fileName: string; source: string }): string;
}

export interface PenguinUiPlugin {
  name: string;
  generateBundle: (this: PenguinUiEmitContext) => void;
}

/** Where the emitted licence texts land in a consumer's dist. */
export const FONT_LICENSES_DIR = "fonts-licenses";

/** The licence texts in `src/fonts/LICENSES/`, `{ fileName, source }` per font, sorted by file name. */
export function fontLicenseAssets(): { fileName: string; source: string }[] {
  const dir = new URL("./fonts/LICENSES/", import.meta.url);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort()
    .map((file) => ({
      fileName: `${FONT_LICENSES_DIR}/${file}`,
      source: readFileSync(new URL(file, dir), "utf8"),
    }));
}

export function penguinUi(): PenguinUiPlugin {
  return {
    name: "penguin:ui",
    // Build only: Vite never calls generateBundle from the dev server.
    generateBundle() {
      for (const asset of fontLicenseAssets()) this.emitFile({ type: "asset", ...asset });
    },
  };
}
