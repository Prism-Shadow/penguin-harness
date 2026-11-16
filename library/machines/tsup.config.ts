import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/machines.ts", "src/browser-extensions.ts", "src/builtin-browser-vocab.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
