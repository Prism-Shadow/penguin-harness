import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/browser-extensions.ts",
    "src/builtin-browser-vocab.ts",
    "src/index.ts",
    "src/machine.ts",
    "src/repos/port-forwards.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
