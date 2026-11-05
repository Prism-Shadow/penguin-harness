/**
 * Browser checks against the component library: layout that only a real engine can measure.
 *
 *   pnpm --filter @prismshadow/penguin-ui-gallery test:e2e
 *
 * Starts the gallery's dev server, or reuses one already answering on the port outside CI.
 * `GALLERY_PORT` moves it off the gallery's fixed 7372, for a machine where another checkout's
 * gallery may already hold that port (a reused server would be testing the other checkout).
 * Needs Playwright's Chromium: `pnpm --filter @prismshadow/penguin-ui-gallery exec playwright
 * install chromium`.
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.GALLERY_PORT ?? 7372);
const BASE = `http://localhost:${PORT}`;
const BASE_PATH = process.env.BASE_PATH ?? "/";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `${BASE}${BASE_PATH}`, headless: true, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec vite --port ${PORT}`,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: `${BASE}${BASE_PATH}lib.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
