import { defineConfig } from "tsup";
// Inlines this checkout's git identity into the artifact — see the helper's module doc:
// the penguin binary bundles core, and a shipped bundle has no path back to the checkout it came from.
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  entry: ["src/penguin.ts", "src/penguin-hmr.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Bundle the workspace source @prismshadow/penguin-core, but keep third-party deps (incl.
  // CJS yaml / smol-toml / agenthub) external and resolved from node_modules at runtime —
  // avoids bundling CJS deps into ESM and triggering a "Dynamic require" error.
  // @prismshadow/penguin-plugins must stay external: it reads files under its own skills/ dir
  // at runtime (files are the source of truth); bundling would break paths relative to the
  // package root. cli already declares it as a direct dependency.
  // @prismshadow/penguin-server stays external: the penguin server / web commands import it
  // dynamically at runtime.
  // tsup treats this package's package.json dependencies as external by default, so these
  // deps are already declared there.
  noExternal: ["@prismshadow/penguin-core"],
  banner: { js: "#!/usr/bin/env node" },
  define: buildGitDefine(),
});
