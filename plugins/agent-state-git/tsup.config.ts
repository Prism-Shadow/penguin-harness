import { defineConfig } from "tsup";

// The runtime reads the fixed platform table and extracts the local package payload.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
