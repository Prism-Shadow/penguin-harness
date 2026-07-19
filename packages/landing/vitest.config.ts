/**
 * Vitest config kept separate from vite.config.ts (same convention as packages/web:
 * vitest's embedded vite types conflict with this package's vite 7 plugin types).
 * Tests cover pure modules only, so no plugins and a node environment suffice.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
