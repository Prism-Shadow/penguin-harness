import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "benchmarkuser";
const P = "password123";

test("Evaluation Center restores its Benchmark after opening a Session trace", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await page.goto(`${BASE}/benchmark`);

  const main = page.locator("main");
  await main.getByRole("button").filter({ hasText: "Example Benchmark" }).click();
  await expect(main.getByRole("heading", { name: "Example Benchmark" })).toBeVisible();

  // Open the latest Evaluation, its first Case, and one sample Run's Session link: this is
  // the exact navigation path that used to unmount BenchmarkPage and lose its selection.
  const evaluations = main.locator("table").first();
  await evaluations.locator("tbody > tr").first().click();
  const caseTable = evaluations.locator("tbody > tr").nth(1).locator("table");
  await caseTable.locator("tbody > tr").first().click();
  await evaluations.locator('a[href^="/traces?agentId=default_agent"]').first().click();
  await expect(page).toHaveURL(/\/traces\?/);

  await page.getByRole("link", { name: /Evaluation Center|评估中心/ }).click();
  await expect(page).toHaveURL(/\/benchmark$/);
  await expect(main.getByRole("heading", { name: "Example Benchmark" })).toBeVisible();
});

test("Evaluation Center restores its Benchmark after leaving an Agent-focused route", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await page.goto(`${BASE}/benchmark`);

  const main = page.locator("main");
  await main.getByRole("button").filter({ hasText: "Example Benchmark" }).click();
  await expect(main.getByRole("heading", { name: "Example Benchmark" })).toBeVisible();

  // Search-param-only navigation keeps BenchmarkPage and each AgentNode mounted. The remembered
  // Agent must therefore reopen when the sidebar removes the focus param; relying on the node's
  // initial `defaultOpen` value would leave its Benchmark list unloaded forever.
  await page.goto(`${BASE}/benchmark?agentId=missing_agent`);
  await expect(main.getByRole("heading", { name: "Example Benchmark" })).toBeHidden();

  await page.getByRole("link", { name: /Evaluation Center|评估中心/ }).click();
  await expect(page).toHaveURL(/\/benchmark$/);
  await expect(main.getByRole("heading", { name: "Example Benchmark" })).toBeVisible();
});
