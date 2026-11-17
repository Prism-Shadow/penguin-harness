import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/model.ts", "src/repos/model-promotions.ts", "src/repos/model-provider-auth-tokens.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
