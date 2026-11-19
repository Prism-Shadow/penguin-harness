import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/benchmark-archive.ts",
    "src/benchmark-service.ts",
    "src/contract.ts",
    "src/index.ts",
    "src/ports.ts",
    "src/types.ts",
    "src/workspace-port.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
