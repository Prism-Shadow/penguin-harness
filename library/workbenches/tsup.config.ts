import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/workbenches.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
