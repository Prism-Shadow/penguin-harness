import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  // Server-side only (node:sqlite), but nothing Node-specific is bundled beyond the imports.
  platform: "neutral",
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
