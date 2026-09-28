import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Resolves against this file's directory: packages/web/e2e/test-results/, the directory CI
  // uploads when a run is red (each failed test's screenshot and trace).
  outputDir: "test-results",
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL,
    headless: true,
    locale: "zh-CN",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
