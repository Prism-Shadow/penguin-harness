/** The landing page's live controls, with one gallery server shared by the suite. */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:7366", headless: true, trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm exec vite --port 7366 --strictPort",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { BASE_PATH: "/" },
      url: "http://localhost:7366",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm exec vite --port 7372 --strictPort",
      cwd: fileURLToPath(new URL("../../ui-gallery", import.meta.url)),
      env: { BASE_PATH: "/gallery/" },
      url: "http://localhost:7372/gallery/app.html",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
