/**
 * Unit tests run in Node against the extension's modules, each test file installing its own fake
 * of the one boundary it crosses (`globalThis.chrome`, the WebSocket, fetch). The real Chrome is
 * the e2e's job (e2e/run.sh).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
