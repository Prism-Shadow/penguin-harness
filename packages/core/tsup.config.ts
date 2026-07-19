import { defineConfig } from "tsup";

export default defineConfig({
  // model-catalog gets its own entry point: pure data, no Node dependency, so web can bundle it directly via subpath import.
  entry: [
    "src/index.ts",
    "src/omnimessage/index.ts",
    "src/interfaces.ts",
    "src/state/model-catalog.ts",
  ],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
});
