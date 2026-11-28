/**
 * Vitest config kept separate from vite.config.ts (same convention as the landing
 * package: vitest's embedded vite types conflict with this package's vite 7 plugin
 * types). Tests cover pure modules and content integrity only, so a node
 * environment with no plugins suffices.
 */
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // references/doc-samples/*.test.ts are standalone executable samples verified
    // via `pnpm --filter @prismshadow/penguin-docs references:verify-samples`.
    exclude: [...configDefaults.exclude, "references/**"],
  },
});
