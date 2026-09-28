import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Total workers. Only the activities project uses more than one.
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL,
    headless: true,
    locale: "zh-CN",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    {
      // Every activities test answers the API itself (`fixture()` routes `**/*`), so the
      // tests share nothing and can run side by side.
      name: "activities",
      testMatch: /activities\.spec\.mjs$/,
      fullyParallel: true,
    },
    {
      // The rest drive one real server and one mock LLM, so they stay one at a time.
      name: "shared-server",
      testIgnore: /activities\.spec\.mjs$/,
      workers: 1,
    },
  ],
});
