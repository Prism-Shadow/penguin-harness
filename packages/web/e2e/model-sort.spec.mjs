/**
 * The gear on a models-page group header, driven in a browser (the unit suites render it to
 * static markup and cannot press anything):
 *
 * - With nothing chosen, a group lists its models by the price billed now, low to high, so its
 *   free models lead.
 * - The gear opens a menu from the keyboard, its focus on the first sort with the current one
 *   checked; the arrows walk it, Enter picks "Name (A→Z)", the menu closes and focus is back on
 *   the gear. The group then lists its models by name, digit runs read as numbers.
 * - The choice survives a reload, and leaves the other groups on price.
 * - Escape closes the menu onto the gear; "Group settings…" still opens the group settings
 *   dialog, which hands focus back to the gear when it closes.
 * - Picking "Price (low to high)" again restores the first order.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;

/** The name and the Free tag of every card in a group's section, in the order shown. */
const cards = (section) =>
  section.evaluate((el) =>
    [...el.querySelectorAll("[data-layout-motion] button")]
      .filter((button) => button.children.length >= 2)
      .map((button) => ({
        name: button.children[0].children[0]?.textContent?.trim() ?? "",
        free: /\bFree\b/.test(button.children[1].textContent ?? ""),
      })),
  );

test("models: a group's gear sorts its models and still opens its settings", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("penguin.lang", "en"));
  await provisionAndLogin(page.request, "modelsortuser", "password123");
  await page.goto(`${BASE}/models`);

  const openRouter = page.getByRole("button", { name: /^OpenRouter\s*\d+ models/ });
  await openRouter.click();
  const section = page.locator("section", { has: openRouter });
  const byPrice = await cards(section);
  expect(byPrice.length, "OpenRouter holds the catalog's rows").toBeGreaterThan(3);
  const firstPaid = byPrice.findIndex((card) => !card.free);
  expect(firstPaid, "a free model leads the default order").toBeGreaterThan(0);
  expect(byPrice.slice(firstPaid).some((card) => card.free)).toBe(false);
  const tokenDance = page.locator("section", {
    has: page.getByRole("button", { name: /^TokenDance\s*\d+ models/ }),
  });
  const tokenDanceByPrice = await cards(tokenDance);

  // Keyboard: open, walk, pick.
  const gear = page.getByRole("button", { name: "Settings OpenRouter", exact: true });
  await expect(gear).toHaveAttribute("aria-haspopup", "menu");
  await gear.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Settings OpenRouter" });
  const priceAsc = menu.getByRole("menuitemradio", { name: "Price (low to high)" });
  await expect(priceAsc).toBeFocused();
  await expect(priceAsc).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const byNameItem = menu.getByRole("menuitemradio", { name: "Name (A→Z)" });
  await expect(byNameItem).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(gear).toBeFocused();

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const byName = (await cards(section)).map((card) => card.name);
  expect(byName).toEqual([...byName].sort(collator.compare));
  expect(byName).not.toEqual(byPrice.map((card) => card.name));

  // Remembered in this browser, for this group alone.
  await page.reload();
  await expect(gear).toBeVisible();
  expect((await cards(section)).map((card) => card.name)).toEqual(byName);
  expect(await cards(tokenDance)).toEqual(tokenDanceByPrice);
  await gear.click();
  await expect(byNameItem).toHaveAttribute("aria-checked", "true");
  await expect(priceAsc).toHaveAttribute("aria-checked", "false");

  // Escape closes onto the gear; Group settings… opens the dialog as the gear used to.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(gear).toBeFocused();
  await gear.click();
  await menu.getByRole("menuitem", { name: "Group settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "OpenRouter group settings" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(gear).toBeFocused();

  // Back to price, low to high: the first order again.
  await gear.click();
  await priceAsc.click();
  await expect(menu).toBeHidden();
  expect(await cards(section)).toEqual(byPrice);
});
