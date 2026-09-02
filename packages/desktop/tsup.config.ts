import { defineConfig } from "tsup";
// Inlines this checkout's git identity into the artifact — see the helper's module doc:
// the app bundles the server and the CLI whole, and a shipped bundle has no path back to the checkout it came from.
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";
// The CJS globals these ESM bundles have to declare for the dependencies they absorb —
// see the helper's module doc for what the shim covers and where it only approximates.
import { ESM_CJS_BANNER } from "../../scripts/esm-cjs-banner.mjs";

/**
 * Five self-contained bundles, no shared chunks: the shell itself, the server it forks as a
 * utilityProcess, the CLI its bin/ launchers start on the app's Electron runtime, and the two
 * modules scripts/build-assets.mjs imports (plain node, no Electron) to produce the rest of
 * the build — launcher.ts writes the launcher scripts, pty-payload.ts stages node-pty.
 *
 * The server and the CLI are bundled from their own packages' build output, so the app runs
 * exactly what an `npm install` of those packages would, linked into one file each.
 *
 * Bundling absorbs every JavaScript dependency, so the app carries no JavaScript dependency
 * tree. Two things cannot be absorbed: node-pty, a native module the server reaches through a
 * runtime `require` whose loader resolves the binary relative to its own package directory —
 * build-assets.mjs stages a package directory for it at dist/node_modules/node-pty (see
 * src/pty-payload.ts) — and the @penguinharness/* plugin packages, data directories the
 * bundled core loader resolves by package name from the bundle's own location, which travel
 * as this package's declared dependencies (electron-builder collects them, pnpm links them).
 */
export default defineConfig({
  entry: {
    main: "src/main.ts",
    launcher: "src/launcher.ts",
    "pty-payload": "src/pty-payload.ts",
    server: "../server/dist/index.js",
    penguin: "../cli/dist/penguin.js",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  // Generated for a source run; electron-builder.yml keeps the .map files out of installers,
  // where they would roughly triple what these bundles add.
  sourcemap: true,
  splitting: false,
  // Load-bearing: bundled CJS dependencies reference `require` (yaml, tar, smol-toml,
  // commander, agenthub) and `__dirname` (@larksuiteoapi/node-sdk) inside their own wrapper,
  // and an ESM bundle supplies neither. scripts/deploy.mjs uses the same banner.
  banner: { js: ESM_CJS_BANNER },
  // `electron` is a runtime builtin inside the Electron main process, and its npm package is
  // only a shim that reads the binary's path from disk — bundling that shim is what a bare
  // `noExternal: [/.*/]` gets you. Everything else is bundled by default: tsup externalizes
  // this package's `dependencies`, and the only ones it declares are the data-only plugin
  // packages, which nothing imports.
  external: ["electron"],
  define: buildGitDefine(),
});
