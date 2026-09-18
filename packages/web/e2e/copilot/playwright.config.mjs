import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
process.env.PENGUIN_COMPONENT_TEST = "1";
export default defineConfig({
  testDir: ".",
  testMatch: "copilot.spec.mjs",
  workers: 1,
  use: { baseURL: "http://localhost:7375", headless: true },
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "pnpm exec vite --host localhost --port 7375 --strictPort",
    url: "http://localhost:7375/e2e/copilot/component.html",
    reuseExistingServer: false,
  },
});
