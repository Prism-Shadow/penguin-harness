/**
 * Vitest config: node environment, tests pure logic only (stream-model / task-stats / format), no DOM tests.
 * Kept separate from vite.config.ts: vitest's bundled vite 5 types conflict with this package's vite 7
 * plugin types, and tests don't need the plugin anyway.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only run unit tests under test/; e2e/ (Playwright, has its own test:e2e) is excluded from vitest.
    include: ["test/**/*.test.ts"],
  },
});
