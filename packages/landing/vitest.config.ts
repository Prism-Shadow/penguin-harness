/**
 * Vitest config kept separate from vite.config.ts (same convention as packages/web:
 * vitest's embedded vite types conflict with this package's vite 7 plugin types).
 * Tests cover pure modules in a node environment; the one plugin is the blog index's, which the
 * blog module imports through.
 */
import { defineConfig } from "vitest/config";
import { blogFrontmatter } from "./scripts/frontmatter-plugin";
import { rfcPrStatus } from "./scripts/rfc-plugin";

export default defineConfig({
  plugins: [blogFrontmatter(), rfcPrStatus({ offline: true })],
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
