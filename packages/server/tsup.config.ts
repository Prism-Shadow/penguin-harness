import { defineConfig } from "tsup";

export default defineConfig({
  // Explicitly name entries to preserve the dist/api/types.js subpath (exports "./api" points to it).
  entry: { index: "src/index.ts", "api/types": "src/api/types.ts" },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: true,
});
