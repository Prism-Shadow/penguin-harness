import { defineConfig } from "tsup";
// Inlines this checkout's git identity into the artifact — see the helper's module doc:
// the app bundles the server and the CLI whole, and a shipped bundle has no path back to the checkout it came from.
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

/**
 * Five self-contained bundles, no shared chunks: the shell itself, the server it forks as a
 * utilityProcess, the CLI its bin/ launchers start on the app's Electron runtime, and the two
 * modules scripts/build-assets.mjs imports (plain node, no Electron) to produce the rest of
 * the build — launcher.ts writes the launcher scripts, pty-payload.ts stages node-pty.
 *
 * The server and the CLI are bundled from their own packages' build output, so the app runs
 * exactly what an `npm install` of those packages would, linked into one file each.
 *
 * Bundling absorbs every JavaScript dependency, so the app carries no dependency tree. node-pty
 * is the one exception and cannot be one: it is a native module the server reaches through a
 * runtime `require`, and its loader resolves the binary relative to its own package directory.
 * build-assets.mjs stages a package directory for it at dist/node_modules/node-pty — the only
 * node_modules the app ships (see src/pty-payload.ts).
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
  define: buildGitDefine(),
});
