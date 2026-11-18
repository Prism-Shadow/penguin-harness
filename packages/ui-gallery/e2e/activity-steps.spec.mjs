import { test, expect } from "@playwright/test";

test("activity display modes work independently of the gallery theme, even on completed work", async ({
  page,
}) => {
  await page.goto("/c/streaming?theme=modern&mode=light&lang=en");
  const frame = page.frameLocator("iframe.g-lib-frame");
  const group = frame.locator(".ui-frame[data-step-view]");
  const rows = group.locator(".ui-tree > [data-depth]");
  const choose = (name) => frame.getByRole("button", { name, exact: true }).click();
  const plan = group.getByText("I’ll read the meeting notes and collect the action items.");
  for (const theme of ["Doodle", "Primer", "Console", "Frost"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await choose("Standard");
    await expect(rows).toHaveCount(2);
    await expect(plan).toBeHidden();
    await choose("Expanded");
    await expect(plan).toBeVisible();
    await rows.locator('button[data-kind="thinking"]').click();
    await expect(plan).toBeHidden();
    await choose("Compact");
    await expect(rows).toHaveCount(0);
    await expect(group.getByRole("group", { name: "Step 2 of 2" })).toBeVisible();
    await group.getByRole("button", { name: "Previous step" }).click();
    await expect(rows).toHaveCount(0);
    await group.locator("button[data-group-header]").click();
    await expect(rows).toHaveCount(1);
    await expect(plan).toBeHidden();
    await rows.locator('button[data-kind="thinking"]').click();
    await expect(plan).toBeVisible();
  }
  await choose("Finish run");
  await expect(group.getByRole("group", { name: "Step 1 of 3" })).toBeVisible();
  await group.getByRole("button", { name: "Latest step" }).click();
  await expect(group.locator("[data-step-terminal]")).toContainText("Run complete");
  await expect(rows).toHaveCount(0);
  await choose("Expanded");
  await expect(rows).toHaveCount(2);
  await expect(plan).toBeVisible();
});
