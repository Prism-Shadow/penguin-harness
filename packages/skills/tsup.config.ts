import { defineConfig } from "tsup";

// The workspace imports the TypeScript source (package.json `exports`), and the package is
// private, so no consumer loads this build.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
