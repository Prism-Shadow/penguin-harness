/**
 * A long start-page draft grows, then accepts a mouse or keyboard resize without replacing the
 * selection. Clearing it gives the page back its space. On a short touch viewport a finger drag
 * resizes the field and the send action is reachable beside it.
 */
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

test("a long draft can be resized with the mouse and arrow keys and shrinks again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const box = await openDraft(page, "draft_height_mouse");
  const short = await height(box);
  await box.fill(lines);
  await expect.poll(() => height(box)).toBeGreaterThan(short * 3);
  const automatic = await height(box);
  await box.evaluate((el) => el.setSelectionRange(11, 17));
  const grip = page.getByRole("separator", { name: "调整草稿输入框高度" });
  await grip.click({ trial: true });
  const rect = await grip.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 84, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => height(box)).toBeGreaterThan(automatic + 60);
  expect(await box.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([11, 17]);
  const adjusted = await height(box);
  await grip.press("ArrowUp");
  await expect.poll(() => height(box)).toBeLessThan(adjusted);
  await expect(box).toHaveValue(lines);
  await box.fill("Short again");
  await expect.poll(() => height(box)).toBe(short);
});

test.describe("a short touch viewport", () => {
  test.use({ viewport: { width: 390, height: 440 }, hasTouch: true, isMobile: true });
  test("a finger resizes the draft and its toolbar stays reachable", async ({ page, context }) => {
    const box = await openDraft(page, "draft_height_touch");
    await box.fill(lines);
    const before = await height(box);
    const grip = page.getByRole("separator", { name: "调整草稿输入框高度" });
    await grip.scrollIntoViewIfNeeded();
    await grip.click({ trial: true });
    const rect = await grip.boundingBox();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 40 }],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => height(box)).toBeLessThan(before - 20);
    const send = page.getByRole("button", { name: "发送", exact: true });
    await page.locator('[data-slot="composer"]').scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(box).toBeInViewport({ ratio: 1 });
    await expect(box).toHaveValue(lines);
    await send.tap();
    await expect(page).toHaveURL(/\/chat\/[^/?#]+/);
  });
});
