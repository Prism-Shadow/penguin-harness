import { defineConfig } from "tsup";

export default defineConfig({
  // Explicitly name entries to preserve subpath exports: "./api", "./lock",
  // "./initial-password" and "./reset-admin-password" (lock, initial-password and
  // reset-admin-password are side-effect-free for CLI pre-checks and the offline
  // admin-password rescue); "./hmr/manifest" is the host-less harness.json reader the
  // CLI's thin loader resolves the current cli bundle through. There is deliberately no
  // "./platform" subpath: src/platform/entry.ts (this package's platform artifact
  // compile target — see its own module doc) is compiled straight from source by
  // esbuild in scripts/deploy.mjs, never through this package's published dist,
  // so it has no reason to be a tsup entry or a subpath export.
  entry: {
    index: "src/index.ts",
    "api/types": "src/api/types.ts",
    lock: "src/lock.ts",
    "initial-password": "src/initial-password.ts",
    "reset-admin-password": "src/reset-admin-password.ts",
    "hmr/manifest": "src/hmr/manifest.ts",
  },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
