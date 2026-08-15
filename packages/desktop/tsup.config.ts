import { defineConfig } from "tsup";

export default defineConfig([
  {
    // launcher.ts is a second entry on purpose: scripts/stage.mjs imports dist/launcher.js
    // at stage time (plain node, no Electron) to generate the CLI launcher scripts.
    entry: ["src/main.ts", "src/launcher.ts"],
    format: ["esm"],
    target: "node22",
    platform: "node",
    clean: true,
    sourcemap: true,
    // `electron` is a runtime builtin inside the Electron main process; the workspace
    // packages stay external so the server entry keeps its own file identity (the shell
    // forks it as a child by path) and lock.js resolves from node_modules.
    external: ["electron", "@prismshadow/penguin-server", "@prismshadow/penguin-core"],
  },
  {
    // The sandboxed preload must be CJS (Electron's sandbox has no ESM loader), and the
    // package is "type": "module" — so it ships as .cjs to keep Node semantics straight.
    entry: ["src/preload.ts"],
    format: ["cjs"],
    target: "node22",
    platform: "node",
    sourcemap: true,
    outExtension: () => ({ js: ".cjs" }),
    external: ["electron"],
  },
]);
