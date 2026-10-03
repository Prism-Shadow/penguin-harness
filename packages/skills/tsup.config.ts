import { defineConfig } from "tsup";

// The workspace imports the TypeScript source (package.json `exports`); the published package
// is this build (`publishConfig.exports`), made by `prepack`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
