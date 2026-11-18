import { test, expect } from "@playwright/test";

test("the theme picker selects the shared live activity's layout", async ({ page }) => {
  await page.goto("/c/streaming?theme=modern&mode=light&lang=en");
  const frame = page.frameLocator("iframe.g-lib-frame");
  const group = frame.locator(".ui-frame:has(> [data-group-header])");
  const rows = group.locator(".ui-tree > [data-depth]");
  await expect(rows).toHaveCount(2);
  for (const name of ["Doodle", "Primer", "Console", "Frost"]) {
    await page.getByRole("button", { name, exact: true }).click();
    if (name === "Doodle") {
      await expect(rows).toHaveCount(1);
      await expect(group.getByRole("group", { name: "Step 2 of 2" })).toBeVisible();
      await group.getByRole("button", { name: "Previous step" }).click();
      await expect(
        group.getByText("I’ll read the meeting notes and collect the action items."),
      ).toBeVisible();
    } else {
      await expect(rows).toHaveCount(2);
      await expect(group.locator("[data-step-navigation]")).toHaveCount(0);
      await expect(group.getByRole("button", { name: "Thinking" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
  }
});
