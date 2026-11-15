import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/traces.ts", "src/repos/trace-index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
