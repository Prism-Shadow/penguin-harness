import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/repos/index.ts", "src/repos/trace-index.ts", "src/trace.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
