import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/app-env.ts",
    "src/attribution.ts",
    "src/errors.ts",
    "src/index.ts",
    "src/json-answer.ts",
    "src/json-compression.ts",
    "src/json-validators.ts",
    "src/media-type.ts",
    "src/page-csp.ts",
    "src/public-origin.ts",
    "src/settle.ts",
    "src/validate.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
