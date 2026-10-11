/**
 * Vitest config: node environment, no DOM. Tests drive the app's logic, its stores and the
 * components that render to static markup; e2e/ (Playwright, `test:e2e`) is excluded.
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
    // Every vi.stubGlobal (fetch, localStorage, …) is undone before the next test starts.
    unstubGlobals: true,
    // `vitest run --coverage`: branch and line coverage of the app's own source.
    coverage: { provider: "v8", include: ["src/**"] },
    // Both settings above reach every project through `extends: true`.
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
