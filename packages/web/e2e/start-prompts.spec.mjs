/**
 * A saved account shortcut is directly usable on a fresh draft alongside the built-in app
 * shortcuts ("Build New App", "Optimize App" and "Publish App"). The shortcut can be renamed,
 * reloaded and deleted.
 */
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

async function fit(group) {
  await expect
    .poll(() =>
      group.evaluate((row) => {
        const over = [];
        for (let el = row; el; el = el.parentElement)
          if (el.scrollWidth > el.clientWidth)
            over.push([el.tagName, el.clientWidth, el.scrollWidth]);
        return over;
      }),
    )
    .toEqual([]);
}

test("saved prompts sit alongside the preset shortcuts and can be managed from a phone", async ({
  page,
}) => {
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
  await expect(
    page.getByText("Create your first self-evolving Harness OS.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="count"]')).toHaveCount(0);
  await fit(shortcuts);
  const suggestions = shortcuts.locator('[data-slot="suggestion"]');
  await expect(suggestions).toHaveCount(3);
  expect(await suggestions.allTextContents()).toEqual([
    "Build New App",
    "Optimize App",
    "Publish App",
  ]);
  const draft = page.locator('[data-slot="composer"] textarea').first();
  await shortcuts.getByRole("button", { name: "Reading notes", exact: true }).click();
  await expect(draft).toHaveValue("Summarize my reading notes.");
  await shortcuts.getByRole("button", { name: "Manage shortcuts", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Name\b/ })
    .fill("Book notes");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(
    shortcuts.locator('[data-slot="saved-prompt"][aria-label="Book notes"]'),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    shortcuts.locator('[data-slot="saved-prompt"][aria-label="Book notes"]'),
  ).toHaveCount(1);
  await shortcuts.getByRole("button", { name: "Manage shortcuts", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(shortcuts.getByRole("button", { name: "Book notes" })).toHaveCount(0);
  await expect(shortcuts.getByRole("button", { name: "New shortcut", exact: true })).toBeVisible();
});

test("long shortcut names fit the keyboard-accessible row on a desktop", async ({ page }) => {
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
  await fit(strip);
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

for (const lang of ["zh", "en"]) {
  test(`examples stay inside each ancestor at page and pane widths in ${lang}`, async ({
    page,
  }) => {
    await provisionAndLogin(page.request, "examplefit" + lang, "password123");
    const family = "👩‍👩‍👦";
    const title = "Cafe\u0301 " + family + " notes for two teams";
    const second = title + " B";
    const prompt = "Write the full plan.\nInclude a checklist for both teams.";
    await setAccountPrefs(page.request, {
      lang,
      draftShortcuts: [
        { id: "fit-a", title, prompt: "First plan" },
        { id: "fit-b", title: second, prompt },
      ],
    });
    await page.goto("/chat/new");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Later|稍后/ })
      .click();
    const row = page.locator('[data-slot="examples"]');
    await expect(row.locator('[data-slot="saved-prompt"]')).toHaveCount(2);
    const { chat } =
      lang === "en"
        ? (await import("../src/lib/strings-en.ts")).en
        : (await import("../src/lib/strings.ts")).zh;
    const firstSuggestion = row.locator('[data-slot="suggestion"]').first();
    await expect(firstSuggestion).toHaveAccessibleName(chat.exampleTasks.buildApp.label);
    await firstSuggestion.click();
    await expect(page.locator('[data-slot="composer"] textarea').first()).toHaveValue(
      chat.exampleTasks.buildApp.prompt,
    );
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await fit(row);
      await row.evaluate((el) => {
        el.parentElement.style.maxWidth = "240px";
        document.documentElement.style.fontSize = "22px";
      });
      await fit(row);
      const item = row.getByRole("button", { name: second, exact: true });
      await expect(item).toHaveAccessibleName(second);
      await item.click();
      // A fill over what an earlier fill put there, untouched, goes straight in.
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator('[data-slot="composer"] textarea').first()).toHaveValue(prompt);
      await row.evaluate((el) => {
        el.parentElement.style.maxWidth = "";
        document.documentElement.style.fontSize = "";
      });
    }
  });
}
