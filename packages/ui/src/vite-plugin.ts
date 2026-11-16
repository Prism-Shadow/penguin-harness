/**
 * `penguinUi()` — the Vite plugin that ships the bundled fonts' licences and, for the Web App, the
 * Workbench runtime.
 *
 * On a build it emits the licence texts in `src/fonts/LICENSES/*.txt` (mirrored from the font
 * packages by `scripts/sync-font-licenses.mjs`, and MiSans's transcribed from its licensor) as
 * `fonts-licenses/<name>.txt`, so every dist that carries the fonts — the served app, the desktop
 * bundle, the gallery — carries their licences beside them. Resolving the package needs no plugin:
 * a consumer's `workspace:*` dependency is linked to this directory.
 *
 * With `workbenchRuntime: true` (the Web App's config, and only it) it also copies the package's
 * built runtime, `dist/workbench/`, into the dist as `workbench-runtime/`. The server reads it from
 * wherever it reads the Web App's files, so every form of the server carries the runtime that
 * answers its Workbench pages. That directory is the one output of this package anything in the
 * repository reads, so a build without it fails rather than shipping a server whose TSX pages
 * cannot load.
 *
 * Every build also carries the built-in theme packs' sources (PRFC-0026 「导出」), so a server can
 * export a built-in pack — the way a person starts a pack of their own — from the very build it
 * serves, offline: each `src/themes/<id>/` with a `pack.json` lands as `themes/<id>/<file>`, its
 * fonts excepted. Those are already in the bundle as hashed assets wherever a stylesheet names
 * them, so `themes/<id>/fonts.json` maps each `fonts/<path>` of the pack to the asset that carries
 * it rather than shipping a second copy (a font no stylesheet names is copied under the pack). The
 * server's export reads them there (`/api/themes/:id/export`); nothing in the page loads them.
 *
 * A vite config imports it by relative path (`../ui/src/vite-plugin`), which the config bundle
 * inlines; it is not one of the package's `exports`. Structural types only, so the package needs
 * no `vite` dependency at run time; `scripts/build-dist.mjs` imports it too.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The slice of Rollup's plugin context the plugin uses. */
export interface PenguinUiEmitContext {
  emitFile(file: { type: "asset"; fileName: string; source: string | Uint8Array }): string;
}

/** The slice of an output bundle entry the plugin reads: which source files an asset came from. */
export interface PenguinUiBundleEntry {
  type: string;
  fileName: string;
  originalFileNames?: readonly string[];
}

export interface PenguinUiPlugin {
  name: string;
  apply: "build";
  configResolved: (config: { root: string }) => void;
  buildStart: () => void;
  generateBundle: (
    this: PenguinUiEmitContext,
    options: unknown,
    bundle: Record<string, PenguinUiBundleEntry>,
  ) => void;
}

export interface PenguinUiOptions {
  /** Copy `dist/workbench/` into the build as `workbench-runtime/`; the build fails without it. */
  workbenchRuntime?: boolean;
}

/** Where the emitted licence texts land in a consumer's dist. */
export const FONT_LICENSES_DIR = "fonts-licenses";

/** Where the Workbench runtime lands in the Web App's dist. */
export const WORKBENCH_RUNTIME_DIR = "workbench-runtime";

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

/** Where the built-in theme packs' sources land in a consumer's dist. */
export const THEME_PACKS_DIR = "themes";

/** `src/themes/`, whose folders holding a `pack.json` are the built-in packs. */
export const builtinThemesDir = (): string => fileURLToPath(new URL("./themes/", import.meta.url));

/** The built-in packs' ids: the folders of `themesDir` that hold a `pack.json`, sorted. */
export function builtinPackIds(themesDir: string = builtinThemesDir()): string[] {
  return readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(themesDir, entry.name, "pack.json")))
    .map((entry) => entry.name)
    .sort();
}

/** Every file of a pack folder by its `/`-separated path in the folder, in path order. */
export function packFolderFiles(packDir: string): Map<string, Uint8Array> {
  const files = readdirSync(packDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => [relative(packDir, path).split("\\").join("/"), path] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return new Map(files.map(([rel, path]) => [rel, readFileSync(path)]));
}

/**
 * The built-in packs' sources as dist assets, with each pack's `fonts.json`: a font the bundle
 * already carries as `assets/…` (an asset whose original file is that font, relative to `root`)
 * is mapped to it, any other is copied under the pack.
 */
export function themePackAssets(
  root: string,
  bundle: Record<string, PenguinUiBundleEntry>,
  themesDir: string = builtinThemesDir(),
): { fileName: string; source: Uint8Array | string }[] {
  const emittedFrom = new Map<string, string>();
  for (const entry of Object.values(bundle)) {
    if (entry.type !== "asset") continue;
    for (const original of entry.originalFileNames ?? []) {
      emittedFrom.set(resolve(root, original), entry.fileName);
    }
  }
  const out: { fileName: string; source: Uint8Array | string }[] = [];
  for (const id of builtinPackIds(themesDir)) {
    const packDir = join(themesDir, id);
    const fonts: Record<string, string> = {};
    for (const [rel, source] of packFolderFiles(packDir)) {
      const fileName = `${THEME_PACKS_DIR}/${id}/${rel}`;
      if (rel.startsWith("fonts/")) {
        const emitted = emittedFrom.get(resolve(packDir, rel));
        fonts[rel] = emitted ?? fileName;
        if (emitted !== undefined) continue;
      }
      out.push({ fileName, source });
    }
    out.push({
      fileName: `${THEME_PACKS_DIR}/${id}/fonts.json`,
      source: `${JSON.stringify(fonts, null, 2)}\n`,
    });
  }
  return out;
}

/** `packages/ui/dist/workbench/`, which `pnpm --filter @prismshadow/penguin-ui build` writes. */
export const workbenchRuntimeDir = (): string =>
  fileURLToPath(new URL("../dist/workbench/", import.meta.url));

/** Every file of the built runtime, as `{ fileName, source }` under {@link WORKBENCH_RUNTIME_DIR}. */
function workbenchRuntimeAssets(dir: string): { fileName: string; source: Uint8Array }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const rel = relative(dir, path).split("\\").join("/");
      return { fileName: `${WORKBENCH_RUNTIME_DIR}/${rel}`, source: readFileSync(path) };
    })
    .sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
}

function assertWorkbenchRuntime(dir: string): void {
  if (existsSync(join(dir, "manifest.json"))) return;
  throw new Error(
    `penguinUi: no Workbench runtime at ${dir}. The Web App's build carries it, and the ` +
      "server's TSX Workbench pages cannot load without it. Build the UI package first: " +
      "pnpm --filter @prismshadow/penguin-ui build",
  );
}

/**
 * Drops the `woff` and `truetype` fallbacks from a KaTeX stylesheet, leaving each `@font-face` with
 * its woff2 source alone.
 *
 * KaTeX ships twenty faces in three formats and lists all three in every `src`, so Vite — which
 * emits an asset for each URL a stylesheet references — copies sixty font files into the bundle.
 * The forty non-woff2 ones are ~800KB that nothing can request: woff2 has been supported by every
 * browser this SPA runs in since 2016, and the desktop shell is Chromium. A browser somehow without
 * it now falls back to the `serif` at the end of KaTeX's own font stack rather than failing.
 *
 * The Web App's Vite config (and through it the gallery's) and the package's own stylesheet build
 * apply it. A silent miss here (a Vite id format change, a KaTeX release that reorders `src`) costs
 * bundle size without breaking anything, so the Web App's suite tests it.
 */
export function dropNonWoff2FontSources(css: string): string {
  return css.replace(/\s*,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "");
}

export function penguinUi(options: PenguinUiOptions = {}): PenguinUiPlugin {
  const runtime = options.workbenchRuntime === true ? workbenchRuntimeDir() : null;
  let root = process.cwd();
  return {
    name: "penguin:ui",
    // Build only: the dev server serves no dist, and the runtime is read from the build.
    apply: "build",
    configResolved(config) {
      // Vite names an asset's original file relative to the project root.
      root = config.root;
    },
    buildStart() {
      // Checked before the bundle is built, so a missing runtime costs seconds, not the build.
      if (runtime !== null) assertWorkbenchRuntime(runtime);
    },
    generateBundle(_options, bundle) {
      for (const asset of fontLicenseAssets()) this.emitFile({ type: "asset", ...asset });
      for (const asset of themePackAssets(root, bundle)) this.emitFile({ type: "asset", ...asset });
      if (runtime === null) return;
      assertWorkbenchRuntime(runtime);
      for (const asset of workbenchRuntimeAssets(runtime)) {
        this.emitFile({ type: "asset", ...asset });
      }
    },
  };
}
