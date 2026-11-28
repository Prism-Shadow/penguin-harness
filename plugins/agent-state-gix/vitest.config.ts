import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The suites run the native addon against real repositories, and real git for the
    // cross-engine checks.
    testTimeout: process.platform === "win32" ? 30_000 : 10_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
