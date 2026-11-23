/** The new-chat textarea follows its content and viewport while keeping keyboard resizing. */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const lines = Array.from({ length: 48 }, (_, i) => `Paragraph ${i + 1} of the draft.`).join("\n");
const height = (box) => box.evaluate((el) => el.clientHeight);

async function openDraft(page, userId) {
  await provisionAndLogin(page.request, userId, "password123");
  const { projects } = await (await page.request.get("/api/projects")).json();
  const model = { provider: "custom", modelId: "claude-4-8" };
  const configured = await page.request.put(`/api/projects/${projects[0].projectId}/models`, {
    data: {
      defaultModel: model,
      models: [
        { ...model, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
      ],
    },
  });
  expect(configured.ok()).toBeTruthy();
  await page.goto("/chat");
  return page.locator('[data-slot="composer"] textarea');
}

test("a long draft grows, accepts keyboard resizing and shrinks after clearing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = await openDraft(page, "keyboard_draft_size");
  const short = await height(box);
  await box.fill(lines);
  await expect.poll(() => height(box)).toBeGreaterThan(short * 3);
  const auto = await height(box);
  await box.evaluate((el) => el.setSelectionRange(11, 17));
  await box.press("Alt+Shift+ArrowDown");
  await expect.poll(() => height(box)).toBeGreaterThan(auto);
  expect(await box.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([11, 17]);
  await box.press("Alt+Shift+ArrowUp");
  await expect.poll(() => height(box)).toBe(auto);
  expect(await box.evaluate((el) => getComputedStyle(el).resize)).toBe("none");
  await expect(page.locator('[data-slot="composer"] [role="separator"]')).toHaveCount(0);
  await box.fill("");
  await expect.poll(() => height(box)).toBe(short);
});

test("a short phone viewport scrolls a long draft and leaves the toolbar reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const box = await openDraft(page, "phone_draft_size");
  await box.fill(lines);
  const tall = await height(box);
  await box.focus();
  await page.setViewportSize({ width: 390, height: 430 });
  await expect.poll(() => height(box)).toBeLessThan(tall);
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('[data-slot="composer"] button').last().scrollIntoViewIfNeeded();
  await expect(page.locator('[data-slot="composer"] button').last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
