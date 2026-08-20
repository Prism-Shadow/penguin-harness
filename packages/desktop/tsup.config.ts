import { defineConfig } from "tsup";

/**
 * Four self-contained bundles, no shared chunks: the shell itself, the server it forks as a
 * utilityProcess, the CLI its bin/ launchers start on the app's Electron runtime, and
 * launcher.ts, which scripts/build-assets.mjs imports (plain node, no Electron) to write
 * those launcher scripts. Because everything is bundled, the packaged app has no runtime
 * dependencies and ships no node_modules at all.
 *
 * The server and the CLI are bundled from their own packages' build output, so the app runs
 * exactly what an `npm install` of those packages would, linked into one file each.
 */
export default defineConfig({
  entry: {
    main: "src/main.ts",
    launcher: "src/launcher.ts",
    server: "../server/dist/index.js",
    penguin: "../cli/dist/penguin.js",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // Generated for a source run; electron-builder.yml keeps the .map files out of installers,
  // where they would roughly triple what these bundles add.
  sourcemap: true,
  splitting: false,
  // Several bundled CJS dependencies (yaml, tar, smol-toml, commander, agenthub) call a bare
  // `require(...)` inside their own wrapper, which esbuild's ESM output otherwise routes to a
  // shim that always throws. Same banner scripts/deploy.mjs uses for the hot-update bundles.
  banner: {
    js: 'import { createRequire as __penguinCreateRequire } from "node:module"; const require = __penguinCreateRequire(import.meta.url);',
  },
  // `electron` is a runtime builtin inside the Electron main process, and its npm package is
  // only a shim that reads the binary's path from disk — bundling that shim is what a bare
  // `noExternal: [/.*/]` gets you. Everything else is bundled by default: tsup externalizes
  // this package's `dependencies`, and it deliberately declares none.
  external: ["electron"],
});
