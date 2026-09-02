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
  // The @penguinharness/* plugin packages are data-only and never imported as modules: the
  // bundled core loader resolves their directories through this package's own dependencies
  // (files are the source of truth), which is why the CLI declares them directly.
  // @prismshadow/penguin-server stays external: the penguin server / web commands import it
  // dynamically at runtime.
  // tsup treats this package's package.json dependencies as external by default, so these
  // deps are already declared there.
  noExternal: ["@prismshadow/penguin-core"],
  banner: { js: "#!/usr/bin/env node" },
  define: buildGitDefine(),
});
