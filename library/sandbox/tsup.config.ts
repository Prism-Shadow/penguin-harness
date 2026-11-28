import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/dimensions.ts",
    "src/service.ts",
    "src/policy.ts",
    "src/status.ts",
    "src/ceiling.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
