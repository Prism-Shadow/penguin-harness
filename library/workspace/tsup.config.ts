import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/contract.ts",
    "src/index.ts",
    "src/types.ts",
    "src/workspace-files-service.ts",
    "src/workspace-group.ts",
    "src/workspace-guard.ts",
    "src/workspace-archive.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
