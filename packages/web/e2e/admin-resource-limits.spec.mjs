import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

async function openSettings(page, user) {
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto("/apps");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp("^" + user) })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Settings", exact: true });
}

test("an administrator edits independent limits and restores the defaults", async ({ page }) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  const path = "/api/admin/settings";
  await expect(
    await page.request.put(path, { data: { terminalMaxOpen: 4, browserMaxOpen: 5 } }),
  ).toBeOK();
  const dialog = await openSettings(page, ADMIN_ID);
  await dialog.getByRole("button", { name: "Terminal and browser limits", exact: true }).click();
  const terminals = dialog.getByRole("spinbutton", { name: "Maximum active terminals per user" });
  const tabs = dialog.getByRole("spinbutton", {
    name: "Maximum pages per built-in browser backend",
  });
  await expect(terminals).toHaveValue("4");
  await expect(tabs).toHaveValue("5");
  await tabs.fill("0");
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await expect(tabs).toHaveAttribute("aria-invalid", "true");
  await tabs.fill("8");
  await save.click();
  await expect(save).toBeDisabled();
  expect((await (await page.request.get(path)).json()).settings).toMatchObject({
    terminalMaxOpen: 4,
    browserMaxOpen: 8,
  });
  await dialog.getByRole("button", { name: "Restore defaults" }).click();
  await save.click();
  await expect(save).toBeDisabled();
  expect((await (await page.request.get(path)).json()).settings).toMatchObject({
    terminalMaxOpen: 12,
    browserMaxOpen: 20,
  });
});

test("a member cannot reach server resource limits", async ({ page }) => {
  const user = "resourcelimitmember";
  await provisionAndLogin(page.request, user, "password123");
  const dialog = await openSettings(page, user);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Terminal and browser limits" })).toHaveCount(0);
  expect(
    (await page.request.put("/api/admin/settings", { data: { terminalMaxOpen: 2 } })).status(),
  ).toBe(403);
});
