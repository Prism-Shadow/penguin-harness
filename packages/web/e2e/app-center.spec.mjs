/**
 * End-to-end test for the App Center (/apps), against the real server and its shipped Support
 * workbench (locale en):
 * - the admin's default Project lists the Support workbench as a tile with its own icon and the
 *   Agent's name; the tile opens the workbench full page, and Exit full screen comes back to the
 *   App Center;
 * - the Show in the App Center switch on the workbench's row takes the tile off, the empty page
 *   explains what a workbench is and offers Create with AI, and switching it on again brings
 *   the tile back.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const SUPPORT = "/agents/penguin_support?tab=workbenches";

test("the App Center opens the Support workbench full page, and its switch takes the tile off and back", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });

  await page.goto(`${BASE}/apps`);
  const grid = page.getByRole("list", { name: "App Center" });
  const tile = grid.getByRole("link", { name: /Support/ });
  await expect(tile).toBeVisible();
  // Its own icon, served from the workbench's ui/ folder, rather than a letter.
  const icon = tile.locator("img");
  await expect(icon).toHaveAttribute("src", /\/workbenches\/support\/ui\/icon\.svg$/);
  expect(await icon.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

  await tile.click();
  await expect(page).toHaveURL(/\/app\/default_project\/penguin_support\/support$/);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(`${BASE}/apps`);

  await page.goto(`${BASE}${SUPPORT}`);
  const toggle = page.getByRole("switch", { name: "Show in the App Center Support" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  // The reload behind the switch compiles the workbench: the row reads back once it is done.
  await expect(toggle).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });

  await page.goto(`${BASE}/apps`);
  await expect(page.getByText("The App Center is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create with AI" })).toBeVisible();

  await page.goto(`${BASE}${SUPPORT}`);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  await page.goto(`${BASE}/apps`);
  await expect(grid.getByRole("link", { name: /Support/ })).toBeVisible();
});
