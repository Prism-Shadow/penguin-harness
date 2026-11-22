// The global setup puts the Git this plugin runs in the repository's cache (see test/global-setup.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    include: ["test/**/*.test.ts"],
    // The suites run real git processes against real repositories.
    testTimeout: process.platform === "win32" ? 30_000 : 10_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
