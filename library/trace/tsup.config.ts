import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/trace.ts",
    "src/repos/index.ts",
    "src/repos/trace-index.ts",
    "src/ports.ts",
    "src/trace-index.ts",
    "src/trace-service.ts",
    "src/trace-head.ts",
    "src/session-id.ts",
    "src/titles.ts",
    "src/listing.ts",
    "src/trace-prompt-label.ts",
    "src/trace-images.ts",
    "src/trace-line-index.ts",
    "src/history-wire.ts",
    "src/history-layout.ts",
    "src/message-window.ts",
    "src/context-breakdown.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
