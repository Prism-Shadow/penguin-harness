import { defineConfig } from "tsup";
import { stageBenchmarks } from "../../scripts/build-benchmarks.mjs";
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
  // CJS yaml / smol-toml / mmsp) external and resolved from node_modules at runtime —
  // avoids bundling CJS deps into ESM and triggering a "Dynamic require" error.
  // The @penguinharness/* plugin packages are library content, not imported as modules (only a
  // `./cli` export is, below): the bundled core loader resolves their directories through this
  // package's own dependencies (files are the source of truth), which is why the CLI declares
  // them directly.
  // @prismshadow/penguin-server stays external: the penguin server / web commands import it
  // dynamically at runtime.
  // tsup treats this package's package.json dependencies as external by default, so these
  // deps are already declared there.
  // A shipped plugin's CLI module (its `./cli` export, listed by cli-modules.gen.ts) is the one
  // piece of a plugin package that is code the CLI runs: it is bundled, so the artifact carries
  // the commands it ships and never imports plugin code at runtime — the same as the push's
  // compile, which inlines everything.
  noExternal: ["@prismshadow/penguin-core", /^@penguinharness\/[^/]+\/cli$/],
  banner: { js: "#!/usr/bin/env node" },
  define: buildGitDefine(),
  onSuccess: () => stageBenchmarks("dist/builtin-benchmarks"),
});
