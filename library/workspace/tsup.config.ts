import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/contract.ts", "src/index.ts", "src/types.ts", "src/workspace-files-service.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
