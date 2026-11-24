/**
 * The plugin's own suites: the tree assembled from seeds, and `/proc`'s two text files parsed into
 * a process's CPU and memory — both without the host or the machine they run on. The suites that
 * boot the whole App with the plugin loaded, and the Web App's page, live in the hosts
 * (packages/server/test, packages/web/test).
 *
 * The server half reaches the host through `@prismshadow/penguin-server/plugin` (and the API's
 * types through `/api`), resolved to the server's sources the way tsconfig.json resolves them:
 * the plugin does not depend on the server package, which depends on it.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const server = (file: string) =>
  fileURLToPath(new URL(`../../packages/server/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@prismshadow/penguin-server/plugin": server("plugin/index.ts"),
      "@prismshadow/penguin-server/api": server("api/types.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
    retry: process.platform === "win32" ? 2 : process.platform === "darwin" ? 1 : 0,
  },
});
