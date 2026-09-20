/**
 * Vitest config: Node environment, no DOM — the web app's convention. Components are exercised
 * through `react-dom/server` static markup (src/testing/render.ts) and source scans; interaction
 * logic lives in pure modules that are called directly.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
