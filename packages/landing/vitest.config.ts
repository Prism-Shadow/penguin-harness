/**
 * Vitest config kept separate from vite.config.ts (same convention as packages/web:
 * vitest's embedded vite types conflict with this package's vite 7 plugin types).
 * Tests cover pure modules only, so no plugins and a node environment suffice.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  // @prismshadow/penguin-ui's .tsx is read from pnpm's injected copy under node_modules, where
  // Vite reads no tsconfig; why, and what that copy misses until `pnpm install`, is in
  // packages/web/vitest.config.ts.
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
});
