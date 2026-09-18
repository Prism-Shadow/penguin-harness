import { test, expect } from "@playwright/test";
test.skip(!process.env.PENGUIN_COMPONENT_TEST, "Uses the isolated component Vite fixture.");

test("shows a device code, reports imported models and cancels on close", async ({
  page,
  context,
}) => {
  let cancelled = false;
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ body: "GitHub fixture" }),
  );
  await page.route("**/api/projects/fixture/model-oauth/**", (route) => {
    const method = route.request().method();
    if (method === "DELETE") {
      cancelled = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (method === "POST")
      return route.fulfill({
        json: {
          flowId: "test-flow",
          authorizeUrl: "https://github.com/login/device",
          userCode: "ABCD-1234",
          expiresAt: Date.now() + 900000,
        },
      });
    return route.fulfill({ json: { status: "done", provider: "github-copilot", applied: 2 } });
  });
  await page.goto("/e2e/copilot/component.html");
  await expect(page.getByText("ABCD-1234")).toBeVisible();
  await expect(page.getByText(/All sessions in this project/)).toBeVisible();
  await page.getByRole("button", { name: "Open authorization page" }).click();
  await expect(page.getByText(/Copilot connected for 2 models/)).toBeVisible();
  await expect(page.getByLabel("Applied models")).toHaveText("2");
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect.poll(() => cancelled).toBe(true);
});

test("shows setup errors with retry, and fits a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/projects/fixture/model-oauth/start", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "invalid_request", message: "Set PENGUIN_COPILOT_CLIENT_ID" } },
    }),
  );
  await page.goto("/e2e/copilot/component.html");
  await expect(page.getByText("Set PENGUIN_COPILOT_CLIENT_ID", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start again" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
