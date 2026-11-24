import { defineConfig } from "tsup";

// Everything the bundle carries is a devDependency of the package: a builtin plugin bundles
// what it runs (scripts/build-plugins.mjs).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
