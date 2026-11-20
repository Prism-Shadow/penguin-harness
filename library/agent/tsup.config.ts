import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/agent-avatar.ts",
    "src/agent-config-service.ts",
    "src/agent-export.ts",
    "src/agent-vocab.ts",
    "src/agent-zip.ts",
    "src/avatar-file.ts",
    "src/contract.ts",
    "src/index.ts",
    "src/memory-archive.ts",
    "src/memory-service.ts",
    "src/memory-transfer-document.ts",
    "src/ports.ts",
    "src/types.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
