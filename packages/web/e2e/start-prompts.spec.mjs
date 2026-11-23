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
