/**
 * A saved account shortcut is directly usable on a fresh draft. Shuffling examples preserves
 * both the draft and that shortcut. The shortcut can be renamed, reloaded and deleted.
 */
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("saved prompts survive a shuffle and can be managed from a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await provisionAndLogin(page.request, "startprompts", "password123");
  await setAccountPrefs(page.request, {
    lang: "en",
    themeId: "doodle",
    draftShortcuts: [
      { id: "sc-reading", title: "Reading notes", prompt: "Summarize my reading notes." },
    ],
  });
  await page.goto(process.env.BASE_URL + "/chat/new");
  const setup = page.getByRole("dialog");
  await setup.getByRole("button", { name: "Later" }).click();
  const shortcuts = page.getByRole("group", { name: "Examples and shortcuts" });
  await expect(page.getByText("Create your first Agent OS", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="count"]')).toHaveCount(0);
  const bounds = await shortcuts.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    centers: [...el.querySelectorAll(":scope > button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return rect.y + rect.height / 2;
    }),
  }));
  expect(bounds.scroll).toBeGreaterThan(bounds.width);
  expect(Math.max(...bounds.centers) - Math.min(...bounds.centers)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const draft = page.locator('[data-slot="composer"] textarea').first();
  await shortcuts.getByRole("button", { name: "Reading notes" }).click();
  await expect(draft).toHaveValue("Summarize my reading notes.");
  const suggestions = shortcuts.locator('[data-slot="suggestion"]');
  const before = await suggestions.allTextContents();
  await shortcuts.getByRole("button", { name: "Shuffle suggestions" }).click();
  await expect(draft).toHaveValue("Summarize my reading notes.");
  await expect(shortcuts.getByRole("button", { name: "Reading notes" })).toBeVisible();
  expect((await suggestions.allTextContents()).every((label) => !before.includes(label))).toBe(
    true,
  );
  await shortcuts.getByRole("button", { name: "Manage shortcuts" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Name\b/ })
    .fill("Book notes");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(shortcuts.getByRole("button", { name: "Book notes" })).toBeVisible();
  await page.reload();
  await expect(shortcuts.getByRole("button", { name: "Book notes" })).toBeVisible();
  await shortcuts.getByRole("button", { name: "Manage shortcuts" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(shortcuts.getByRole("button", { name: "Book notes" })).toHaveCount(0);
  await expect(shortcuts.getByRole("button", { name: "New shortcut" })).toBeVisible();
});

test("long shortcut names fit one keyboard-accessible row on a desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await provisionAndLogin(page.request, "longshortcuts", "password123");
  const longName = "笔记".repeat(10) + " report";
  await setAccountPrefs(page.request, {
    lang: "en",
    draftShortcuts: [
      { id: "sc-chinese", title: longName, prompt: "A longer Chinese shortcut" },
      {
        id: "sc-english",
        title: "Quarterly report and follow-up",
        prompt: "A longer English shortcut",
      },
    ],
  });
  await page.goto("/chat/new");
  await page.getByRole("dialog").getByRole("button", { name: "Later" }).click();
  const strip = page.getByRole("group", { name: "Examples and shortcuts" });
  const end = strip.getByRole("button", { name: "Manage shortcuts" });
  const first = strip.locator("button").first();
  await first.focus();
  for (let i = 0; i < 12 && !(await end.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(end).toBeFocused();
  await expect(end).toBeInViewport();
  const saved = strip.getByRole("button", { name: longName, exact: true });
  await saved.click();
  await expect(page.locator('[data-slot="composer"] textarea')).toHaveValue(
    "A longer Chinese shortcut",
  );
  const brand = await page.locator('[data-slot="brand"]').boundingBox(),
    box = await page.locator('[data-slot="composer"]').boundingBox(),
    footer = await page.locator('[data-slot="version"]').boundingBox();
  expect(brand.y + brand.height).toBeLessThanOrEqual(box.y);
  expect(footer.y).toBeGreaterThan(box.y + box.height);
  expect(footer.y + footer.height).toBeGreaterThan(640);
});
