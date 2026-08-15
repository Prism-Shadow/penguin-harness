import { defineConfig } from "tsup";

export default defineConfig({
  // Explicitly name entries to preserve subpath exports: "./api", "./lock",
  // "./initial-password" (lock and initial-password are side-effect-free for CLI
  // pre-checks); "./hmr/manifest" is the host-less harness.json reader the CLI's thin
  // loader resolves the current cli bundle through; "./platform" is the packaged
  // hotPlatform stub packages/cli/src/platform-bundle.ts re-exports into the unified
  // bundle esbuild compiles (see scripts/watch-push.mjs) — it is NOT itself part of
  // that bundle; only its compiled dist output is imported from there.
  entry: {
    index: "src/index.ts",
    "api/types": "src/api/types.ts",
    lock: "src/lock.ts",
    "initial-password": "src/initial-password.ts",
    "hmr/manifest": "src/hmr/manifest.ts",
    "platform/platform": "src/platform/platform.ts",
  },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
