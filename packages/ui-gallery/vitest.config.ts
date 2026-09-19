/**
 * Vitest config kept separate from vite.config.ts (vitest's embedded vite types conflict with
 * this package's vite 7 plugin types). The tests cover the gallery's pure modules only, so a node
 * environment suffices; `@prismshadow/penguin-ui` resolves to the package's live source through
 * the workspace link, as it does for the app.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
