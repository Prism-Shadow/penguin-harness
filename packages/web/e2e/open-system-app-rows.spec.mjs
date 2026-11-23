import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const apps = (page) =>
  page
    .getByRole("navigation", { name: "Apps", exact: true })
    .getByRole("list", { name: "Apps", exact: true });
const tile = (page, title) =>
  page
    .getByRole("list", { name: "App Center" })
    .getByRole("button", { name: new RegExp("^" + title + ",") });
const appRow = (page, key) => apps(page).locator(`[data-app-row="system_agent/${key}"]`);

async function sidebar(page) {
  if (await apps(page).isVisible()) return;
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Sessions/ })
    .click();
  await expect(apps(page)).toBeVisible();
}

async function catalog(page) {
  await sidebar(page);
  await page.getByRole("link", { name: /^App Center(?: ·|$)/ }).click();
  await expect(page.getByRole("list", { name: "App Center" })).toBeVisible();
}

async function windowAction(page, key, action) {
  await sidebar(page);
  const row = apps(page)
    .getByRole("listitem")
    .filter({ has: page.locator(`[data-app-row="system_agent/${key}"]`) });
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

for (const [screen, width] of [
  ["desktop", 1280],
  ["phone", 390],
]) {
  test(
    "open native system apps appear once in the Apps directory on " + screen,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await provisionAndLogin(page.request, "sysrows" + screen, "password123");
      await setAccountPrefs(page.request, { lang: "en" });
      await page.goto("/apps");
      await expect(tile(page, "Models")).toBeVisible();
      await expect(tile(page, "Machines")).toHaveCount(0);
      for (const [key, title] of [
        ["models", "Models"],
        ["plugins", "Plugins"],
      ]) {
        await tile(page, title).click();
        await expect(page).toHaveURL(new RegExp("/" + key + "$"));
        await sidebar(page);
        await expect(appRow(page, key)).toHaveCount(1);
        await expect(appRow(page, key)).toHaveAttribute("aria-current", "page");
        await catalog(page);
        await tile(page, title).click();
        await sidebar(page);
        await expect(appRow(page, key)).toHaveCount(1);
        await catalog(page);
      }
      await sidebar(page);
      await expect(appRow(page, "machines")).toHaveCount(0);
      await appRow(page, "models").click();
      await expect(page).toHaveURL(/\/models$/);
      await windowAction(page, "models", "Minimize");
      await sidebar(page);
      await expect(appRow(page, "models")).toHaveCount(1);
      await appRow(page, "models").click();
      await expect(page).toHaveURL(/\/models$/);
      await windowAction(page, "models", "Close");
      await sidebar(page);
      await expect(appRow(page, "models")).toHaveCount(0);
      await expect(appRow(page, "plugins")).toHaveCount(1);
      await catalog(page);
      await expect(tile(page, "Models")).toBeVisible();
    },
  );
}

test("an administrator can open the Machines app from its own Apps directory entry", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.goto("/apps");
  await tile(page, "Machines").click();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(appRow(page, "machines")).toHaveCount(1);
  await catalog(page);
  await appRow(page, "machines").click();
  await expect(page).toHaveURL(/\/machines$/);
});
