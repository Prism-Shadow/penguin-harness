import { defineConfig } from "tsup";

export default defineConfig({
  // Explicitly name entries to preserve the dist/api/types.js and dist/lock.js subpaths
  // (exports "./api" and "./lock" point to them; lock is side-effect-free for pre-checks).
  entry: { index: "src/index.ts", "api/types": "src/api/types.ts", lock: "src/lock.ts" },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
