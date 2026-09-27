/**
 * Vitest config: node environment, tests pure logic only (stream-model / task-stats / format), no DOM tests.
 * Kept separate from vite.config.ts: vitest's bundled vite 5 types conflict with this package's vite 7
 * plugin types, and tests don't need the plugin anyway.
 *
 * One project per Web module (test/web-modules.ts) runs that module's own tests alone:
 * `vitest run --project terminal`. The `app` project is everything under test/.
 */
import { defineConfig } from "vitest/config";
import { WEB_MODULES } from "./test/web-modules";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      // Only run unit tests under test/; e2e/ (Playwright, has its own test:e2e) is excluded from vitest.
      { extends: true, test: { name: "app", include: ["test/**/*.test.ts"] } },
      ...WEB_MODULES.map((m) => ({
        extends: true as const,
        test: { name: m.name, include: [`src/features/${m.name}/test/**/*.test.ts`] },
      })),
    ],
  },
});
