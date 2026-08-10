import { defineConfig } from "tsup";

export default defineConfig({
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
});
