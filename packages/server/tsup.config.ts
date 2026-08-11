import { defineConfig } from "tsup";

export default defineConfig({
  // Explicitly name entries to preserve the dist/api/types.js, dist/lock.js and
  // dist/initial-password.js subpaths (exports "./api", "./lock" and "./initial-password"
  // point to them; lock and initial-password are side-effect-free for CLI pre-checks).
  entry: {
    index: "src/index.ts",
    "api/types": "src/api/types.ts",
    lock: "src/lock.ts",
    "initial-password": "src/initial-password.ts",
  },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
