import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/observability.ts",
    "src/usage-service.ts",
    "src/dates.ts",
    "src/repos/errors.ts",
    "src/repos/index.ts",
    "src/repos/usage.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
