/**
 * Vitest config kept separate from vite.config.ts (same convention as packages/web:
 * vitest's embedded vite types conflict with this package's vite 7 plugin types).
 * Tests cover pure modules in a node environment; the one plugin is the blog index's, which the
 * blog module imports through.
 */
import { defineConfig } from "vitest/config";
import { blogFrontmatter } from "./scripts/frontmatter-plugin";

export default defineConfig({
  // @prismshadow/penguin-ui's .tsx is read from pnpm's injected copy under node_modules, where
  // Vite reads no tsconfig; why, and what that copy misses until `pnpm install`, is in
  // packages/web/vitest.config.ts.
  esbuild: { jsx: "automatic" },
  plugins: [blogFrontmatter()],
  test: { environment: "node" },
});
