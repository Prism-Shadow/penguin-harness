// The global setup puts the Git this plugin runs in the repository's cache (see test/global-setup.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // TEMPORARY, removed in the next commit: one CI run of the bench on each platform's runner.
    include: ["test/**/*.test.ts", ...(process.env.CI ? ["bench/**/*.bench-run.ts"] : [])],
    // The suites run real git processes against real repositories.
    testTimeout: process.platform === "win32" ? 30_000 : 10_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
