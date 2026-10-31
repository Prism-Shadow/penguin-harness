/**
 * `penguinManifest()` — the Vite plugin that generates the app's PWA manifest.
 *
 * `public/manifest.webmanifest` is not committed: a generated file next to a hand-written
 * `package.json` is one edit away from disagreeing with it, and the manifest is exactly the
 * package's own metadata (`name`, `description`, `version`) plus the install surface's shape
 * (standalone, `/`, the penguin icons — assets of `public/` like any other). On a build the
 * manifest is emitted into `dist/` from the package.json at build time; on a dev server it is
 * answered by a middleware reading the same fields, so "add to home screen" against `pnpm dev`
 * sees the package too. The generated document is exported (`appManifest`) so the test asserts
 * against the generator rather than against a second hand-written copy.
 *
 * A vite config imports it by relative path on purpose — see `vite-plugin`'s module doc — and
 * the plugin stays structural, so this package needs no `vite` dependency either.
 */
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

export const MANIFEST_FILE = "manifest.webmanifest";
/** The generated manifest, served at `/manifest.webmanifest` and emitted into every build. */
export interface AppManifest {
  name: string;
  short_name: string;
  description: string;
  version: string;
  start_url: string;
  scope: string;
  display: "standalone";
  icons: { src: string; sizes: string; type: "image/png" }[];
}

/** The package.json this plugin reads: the fields the manifest is generated from. */
export interface ManifestPackage {
  name?: string;
  version?: string;
  description?: string;
}

/**
 * The manifest for the web package: user-facing `name` is the product's (the package name
 * carries the npm scope), everything else is the package's own, verbatim.
 */
export function appManifest(pkg: ManifestPackage): AppManifest {
  return {
    name: "PenguinHarness",
    short_name: "PenguinHarness",
    description: pkg.description ?? "",
    version: pkg.version ?? "0.0.0",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/penguin-logo-192.png", sizes: "192x192", type: "image/png" },
      { src: "/penguin-logo-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

/** This package's `package.json`, read once per plugin. */
function readPackage(): ManifestPackage {
  return JSON.parse(
    readFileSync(new URL("../../web/package.json", import.meta.url), "utf8"),
  ) as ManifestPackage;
}

export interface PenguinManifestPlugin {
  name: string;
  /** The generated manifest as JSON, for the dev middleware and the build emitter. */
  generateBundle: (this: {
    emitFile(file: { type: "asset"; fileName: string; source: string }): string;
  }) => void;
}

/** The dev-server middleware: answers `/manifest.webmanifest` from the package.json. */
export function manifestMiddleware(
  manifest: AppManifest,
): (req: { url?: string }, res: ServerResponse, next: () => void) => void {
  const body = JSON.stringify(manifest, null, 2);
  return (req, res, next) => {
    if (req.url?.split("?")[0] !== `/${MANIFEST_FILE}`) return next();
    res.statusCode = 200;
    res.setHeader("content-type", "application/manifest+json; charset=utf-8");
    res.end(body);
  };
}

export function penguinManifest(): PenguinManifestPlugin {
  const pkg = readPackage();
  const manifest = appManifest(pkg);
  return {
    name: "penguin:manifest",
    // Build only: Vite never calls generateBundle from the dev server; there the
    // middleware above answers instead, from the same generated document.
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: JSON.stringify(manifest, null, 2),
      });
    },
    // Vitest's config embeds vite 5 (see vitest.config.ts), so the dev-server hook is typed
    // structurally here rather than through vite's own Plugin type.
    configureServer(server: {
      middlewares: { use: (fn: ReturnType<typeof manifestMiddleware>) => void };
    }) {
      server.middlewares.use(manifestMiddleware(manifest));
    },
  } as PenguinManifestPlugin & { configureServer: unknown };
}
