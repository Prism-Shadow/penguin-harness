import { defineConfig } from "tsup";

// dugite (its pinned table of Git builds) and tar (to unpack one) are devDependencies, so the
// bundle carries them: a builtin plugin bundles what it runs (scripts/build-plugins.mjs).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
