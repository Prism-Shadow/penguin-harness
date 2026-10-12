import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";
import { FAR_SIDE_SCRIPTS } from "../../scripts/far-side-scripts.mjs";

const jsOnly = process.env.PENGUIN_BUILD_JS_ONLY === "1";

export default defineConfig({
  // Explicitly name entries to preserve subpath exports: "./api", "./lock",
  // "./initial-password" and "./reset-admin-password" (lock, initial-password and
  // reset-admin-password are side-effect-free for CLI pre-checks and the offline
  // admin-password rescue); "./secret-file" is the shared symlink-safe writer;
  // "./hmr/manifest" is the host-less harness.json reader the CLI's thin loader
  // resolves the current cli bundle through, and "./version-report" is the shared
  // assembler `penguin version` and GET /api/version both render (core plus that
  // same reader — no server). There is deliberately no
  // "./platform" subpath: src/hmr/entry.ts (this package's platform artifact
  // compile target — see its own module doc) is compiled straight from source by
  // esbuild in scripts/deploy.mjs, never through this package's published dist,
  // so it has no reason to be a tsup entry or a subpath export.
  entry: {
    index: "src/index.ts",
    "api/types": "src/api/types.ts",
    lock: "src/lock.ts",
    // "./machine-status": what `penguin server status` prints. A CONTROLLER runs that command
    // over ssh to ask a machine what it is, so the reader has to be importable without a
    // server — see src/machine-status.ts.
    "machine-status": "src/machine-status.ts",
    "initial-password": "src/initial-password.ts",
    "reset-admin-password": "src/reset-admin-password.ts",
    "auth-token": "src/auth-token.ts",
    "secret-file": "src/secret-file.ts",
    "hmr/manifest": "src/hmr/manifest.ts",
    "version-report": "src/version-report.ts",
    // "./benchmark-package": a Benchmark folder or zip as the import route's upload, held to the
    // route's caps — what `penguin benchmark import` sends.
    "benchmark-package": "src/benchmark-package.ts",
    // "./plugin": the surface plugin PACKAGES compile against. Plugins live outside
    // this bundle entirely — they are configuration resolved from the installation,
    // not platform capability.
    "plugin/index": "src/plugin/index.ts",
  },
  format: ["esm"],
  target: "node24",
  // PENGUIN_BUILD_JS_ONLY=1 skips the declarations: scripts/dev-prebuild.mjs builds this
  // package only so that the dev CLI's runtime imports of it resolve, and nothing at
  // runtime reads a .d.ts. The declaration pass is most of a full build's time. The
  // declarations an earlier full build left are kept rather than cleaned, so the CLI's and
  // the desktop's typecheck still find this package's types after a dev start.
  dts: !jsOnly,
  clean: jsOnly ? ["!**/*.d.ts"] : true,
  sourcemap: true,
  // The hot-update mechanism is a package for the boundary, not for npm (it is `private`):
  // inlined here so this package's published dist stays self-contained.
  noExternal: ["@prismshadow/penguin-hmr"],
  // Scripts that run somewhere else, as REAL files beside the bundles: the release installers
  // a remote install feeds to the far side (the one thing that has to arrive before the CLI
  // does; everything after is a `penguin` subcommand the machine already has). Each is
  // resolved next to this module at runtime, so each has to exist in dist/ —
  // which `files: ["dist"]` is what npm ships. tsup only emits its entries, and these are
  // copied and never imported, so nothing in the module graph would pull them along. A
  // missing source throws here, failing the build rather than shipping a package whose
  // Machines page dies at "prepare the installer".
  //
  // The SET comes from scripts/far-side-scripts.mjs, shared with the hot push that has to
  // ship the same one (see that module): two hand-kept copies drifted once already.
  onSuccess: async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repo = path.join(here, "..", "..");
    for (const { name, from } of FAR_SIDE_SCRIPTS) {
      fs.copyFileSync(path.join(repo, from), path.join(here, "dist", name));
    }
  },
});
