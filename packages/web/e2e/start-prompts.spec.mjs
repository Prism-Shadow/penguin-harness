/**
 * A saved account shortcut is directly usable on a fresh draft. Shuffling examples preserves
 * both the draft and that shortcut. The shortcut can be renamed, reloaded and deleted.
 */
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

async function action(page, group, name) {
  const inline = group.getByRole("button", { name, exact: true });
  if (await inline.count()) return inline;
  const more = group.getByRole("button", { name: /More examples|更多示例/ });
  await more.click();
  return page
    .getByRole("dialog", { name: /More examples|更多示例/ })
    .getByRole("button", { name, exact: true });
}

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
  await expect(
    page.getByText("Create your first self-evolving Harness OS.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="count"]')).toHaveCount(0);
  await fit(shortcuts);
  const draft = page.locator('[data-slot="composer"] textarea').first();
  await (await action(page, shortcuts, "Reading notes")).click();
  await expect(draft).toHaveValue("Summarize my reading notes.");
  const suggestions = shortcuts.locator('[data-slot="suggestion"]');
  const before = await suggestions.allTextContents();
  await (await action(page, shortcuts, "Shuffle suggestions")).click();
  await expect(draft).toHaveValue("Summarize my reading notes.");
  expect((await suggestions.allTextContents()).every((label) => !before.includes(label))).toBe(
    true,
  );
  await (await action(page, shortcuts, "Manage shortcuts")).click();
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
  await (await action(page, shortcuts, "Manage shortcuts")).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(shortcuts.getByRole("button", { name: "Book notes" })).toHaveCount(0);
  await expect(await action(page, shortcuts, "New shortcut")).toBeVisible();
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
  await fit(strip);
  const entry = strip.getByRole("button", { name: "More examples" });
  if (await entry.count()) {
    await entry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "More examples" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const saved = await action(page, strip, longName);
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
    const label = await row.locator('[data-slot="suggestion"]').first().getAttribute("aria-label");
    const expected = Object.values(chat.exampleTasks).find((option) => option.label === label);
    await (await action(page, row, label)).click();
    await expect(page.locator('[data-slot="composer"] textarea').first()).toHaveValue(
      expected.prompt,
    );
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await fit(row);
      await row.evaluate((el) => {
        el.parentElement.style.maxWidth = "240px";
        document.documentElement.style.fontSize = "22px";
      });
      await fit(row);
      const item = await action(page, row, second);
      await expect(item).toHaveAccessibleName(second);
      await item.click();
      await expect(page.locator('[data-slot="composer"] textarea').first()).toHaveValue(prompt);
      await row.evaluate((el) => {
        el.parentElement.style.maxWidth = "";
        document.documentElement.style.fontSize = "";
      });
    }
  });
}

test("saved actions take the shared positions and every overflow prompt is reachable", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "priorityshortcuts", "password123");
  const saved = Array.from({ length: 3 }, (_, index) => ({
    id: "plan-" + index,
    title: "Weekly plan " + (index + 1),
    prompt: "Draft the weekly plan for team " + (index + 1) + ".",
  }));
  await setAccountPrefs(page.request, { lang: "en", draftShortcuts: saved });
  await page.goto("/chat/new");
  await page.getByRole("dialog").getByRole("button", { name: "Later" }).click();
  const row = page.getByRole("group", { name: "Examples and shortcuts" });
  const draft = page.locator('[data-slot="composer"] textarea').first();
  for (const [width, count] of [
    [1280, 3],
    [375, 2],
    [320, 1],
  ]) {
    await page.setViewportSize({ width, height: 820 });
    const direct = row.locator('[data-slot="saved-prompt"]');
    await expect(direct).toHaveCount(count);
    expect(await direct.allTextContents()).toEqual(saved.slice(0, count).map((item) => item.title));
    await expect(row.locator('[data-slot="suggestion"]')).toHaveCount(0);
    await fit(row);
    await expect(row.getByRole("button", { name: "Manage shortcuts" })).toBeVisible();
    const more = row.getByRole("button", { name: "More examples" });
    await more.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "More examples" });
    for (const item of saved.slice(count))
      await expect(dialog.getByRole("button", { name: item.title })).toBeVisible();
    const examples = dialog
      .locator("button")
      .filter({ hasNotText: /Weekly plan|Shuffle suggestions/ });
    const before = (await examples.allTextContents()).filter(Boolean);
    await dialog.getByRole("button", { name: "Shuffle suggestions" }).click();
    const after = (await examples.allTextContents()).filter(Boolean);
    expect(before).toHaveLength(3);
    expect(after.every((name) => !before.includes(name))).toBe(true);
    if (count === saved.length) {
      await page.keyboard.press("Escape");
      await direct.last().click();
    } else {
      await dialog.getByRole("button", { name: saved[2].title }).click();
    }
    await expect(draft).toHaveValue(saved[2].prompt);
  }
});
