import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/workbench.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
