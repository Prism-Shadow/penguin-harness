/**
 * Vitest config kept separate from vite.config.ts (same convention as the landing
 * package: vitest's embedded vite types conflict with this package's vite 7 plugin
 * types). Tests cover pure modules and content integrity only, so a node
 * environment with no plugins suffices.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  // @prismshadow/penguin-ui's .tsx is read from pnpm's injected copy under node_modules, where
  // Vite reads no tsconfig; why, and what that copy misses until `pnpm install`, is in
  // packages/web/vitest.config.ts.
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
});
