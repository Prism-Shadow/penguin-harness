import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/model.ts",
    "src/origins.ts",
    "src/platform-auth-flow.ts",
    "src/model-oauth-service.ts",
    "src/modelscope-auth-service.ts",
    "src/platform-auth-service.ts",
    "src/model-catalog/index.ts",
    "src/model-catalog/catalog.ts",
    "src/model-catalog/client-protocols.ts",
    "src/model-catalog/env-keys.ts",
    "src/model-catalog/seed.ts",
    "src/repos/model-promotions.ts",
    "src/repos/model-provider-auth-tokens.ts",
    "src/model-balance.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
