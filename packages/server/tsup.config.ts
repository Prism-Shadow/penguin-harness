import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

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
    "initial-password": "src/initial-password.ts",
    "reset-admin-password": "src/reset-admin-password.ts",
    "auth-token": "src/auth-token.ts",
    "secret-file": "src/secret-file.ts",
    "hmr/manifest": "src/hmr/manifest.ts",
    "version-report": "src/version-report.ts",
  },
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  // Scripts that run somewhere else, as REAL files beside the bundles: the release installers
  // a remote install feeds to the far side, and the applier a hot upgrade runs there. Each is
  // resolved next to this module at runtime, so each has to exist in dist/ — which
  // `files: ["dist"]` is what npm ships. tsup only emits its entries, and these are copied
  // and never imported, so nothing in the module graph would pull them along. A missing
  // source throws here, failing the build rather than shipping a package whose Machines page
  // dies at "prepare the installer".
  onSuccess: async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const name of ["install.sh", "install.ps1"]) {
      fs.copyFileSync(path.join(here, "..", "..", name), path.join(here, "dist", name));
    }
    for (const name of ["remote-upgrade.cjs", "remote-signin.cjs"]) {
      fs.copyFileSync(path.join(here, "src", "machines", name), path.join(here, "dist", name));
    }
  },
});
