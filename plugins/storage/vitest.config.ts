/**
 * The plugin's own suites: the CLI half's commands against a stand-in server. The suites that
 * boot the whole App with this plugin loaded live in the host (packages/server/test/storage/),
 * and the web half's in the Web App's (packages/web/test/storage-*.test.ts).
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
