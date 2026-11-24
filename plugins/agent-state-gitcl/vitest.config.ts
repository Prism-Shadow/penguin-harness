import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The suites run real git processes against real repositories.
    testTimeout: process.platform === "win32" ? 30_000 : 10_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
