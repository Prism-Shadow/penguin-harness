/**
 * Vitest config: node environment, no DOM. Tests drive the app's logic, its stores and the
 * components that render to static markup; e2e/ (Playwright, `test:e2e`) is excluded.
 * Kept separate from vite.config.ts: vitest's bundled vite 5 types conflict with this package's vite 7
 * plugin types, and tests don't need the plugin anyway. CI runs the suite in two halves, one job
 * each (`--shard=1/2`, `--shard=2/2`: scripts/ci-plan.mjs).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  // @prismshadow/penguin-ui arrives as pnpm's injected copy (injectWorkspacePackages), a hard-linked
  // copy of packages/ui under node_modules/.pnpm: since vitest 4 left packages/ui's own graph without
  // supports-color, its peer set no longer matches this package's and pnpm stops deduping the copy
  // back to a link. Vite reads no tsconfig for files under node_modules, so without this line the
  // copy's .tsx compiles with the classic runtime ("React is not defined"). Only `pnpm install`
  // refreshes the copy: a file added to packages/ui, or one replaced rather than edited in place
  // (git checkout, an editor's atomic save), is not seen here until it runs. Same in landing, docs
  // and ui-gallery.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Every vi.stubGlobal (fetch, localStorage, …) is undone before the next test starts.
    unstubGlobals: true,
    // `vitest run --coverage`: branch and line coverage of the app's own source.
    coverage: { provider: "v8", include: ["src/**"] },
  },
});
