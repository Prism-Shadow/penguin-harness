import { expect, test } from "@playwright/test";

test("the public product demo opens chat without offering account onboarding", async ({ page }) => {
  await page.goto("app.html?route=%2Fchat%2Fnew&lang=en&theme=modern");
  await expect(page.locator('[data-slot="composer"]:visible textarea')).toBeVisible();
  await expect(page.getByRole("region", { name: "Your first workbench" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Connect a model provider first" })).toHaveCount(0);
});
