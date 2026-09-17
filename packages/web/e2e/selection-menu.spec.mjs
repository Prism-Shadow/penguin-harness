/**
 * The conversation's selection menu: text selected in the message stream answers a secondary
 * click (and Shift+F10) with the app's own menu — 复制 / 添加到对话 — instead of the browser's.
 * - 添加到对话 stages the excerpt as a chip in the composer (its tooltip is the whole excerpt),
 *   types nothing into the draft, sends nothing, and leaves the text selected; sending then
 *   carries the excerpt as a Markdown blockquote ahead of what was typed.
 * - 复制 writes the selection to the clipboard and confirms with a toast.
 * - With nothing selected, or a selection that runs out of the stream, the app's menu stays shut.
 * The mock's default branch drives it: one tool call, then the reply whose first paragraph is
 * "Command finished; the result looks as expected." (mock-llm.mjs).
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "selectionuser";
const P = "password123";
const SENTENCE = "Command finished; the result looks as expected.";

/** Selects the reply paragraph reading SENTENCE — or, with `runOut`, from it to the end of the page. */
async function selectReply(page, runOut = false) {
  await page.evaluate(
    ({ sentence, runOut }) => {
      const p = [...document.querySelectorAll("p")].find(
        (el) => el.textContent?.trim() === sentence,
      );
      if (!p) throw new Error("reply paragraph not found");
      const range = document.createRange();
      if (runOut) {
        range.setStart(p, 0);
        range.setEnd(document.body, document.body.childNodes.length);
      } else {
        range.selectNodeContents(p);
      }
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { sentence: SENTENCE, runOut },
  );
}

const selectedText = (page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test("selected conversation text offers Copy and Add to conversation", async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.waitFor();
  await composer.fill("check the directory");
  await page.getByRole("button", { name: "发送" }).click();
  const reply = page.getByText(SENTENCE, { exact: true });
  await expect(reply).toBeVisible({ timeout: 30_000 });

  const copyRow = page.getByRole("button", { name: "复制", exact: true });
  const addRow = page.getByRole("button", { name: "添加到对话", exact: true });

  // Nothing selected: the app's menu stays shut and the browser keeps its own.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await reply.click({ button: "right" });
  await expect(addRow).toHaveCount(0);

  // A selection that runs out of the stream: still the browser's menu.
  await selectReply(page, true);
  await reply.click({ button: "right" });
  await expect(addRow).toHaveCount(0);

  // A selection inside the reply: the app's menu, Copy first.
  await selectReply(page);
  await reply.click({ button: "right" });
  await expect(copyRow).toBeVisible();
  await expect(addRow).toBeVisible();
  await addRow.click();

  // Staged as a chip whose tooltip is the whole excerpt. The draft stays empty, nothing was
  // sent, the menu has closed, and the text is still selected.
  const chip = page.locator(`span[title="${SENTENCE}"]`);
  await expect(chip).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(addRow).toHaveCount(0);
  await expect.poll(() => selectedText(page)).toBe(SENTENCE);

  // Copy: the selection reaches the clipboard, confirmed with a toast.
  await reply.click({ button: "right" });
  await copyRow.click();
  await expect(page.getByText("已复制")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SENTENCE);
  await expect.poll(() => selectedText(page)).toBe(SENTENCE);

  // The keyboard reaches the same menu from inside the stream, and Escape hands focus back.
  const replyCopy = page.getByRole("button", { name: "复制回复" }).first();
  await replyCopy.focus();
  await selectReply(page);
  await page.keyboard.press("Shift+F10");
  await expect(addRow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addRow).toHaveCount(0);
  await expect(replyCopy).toBeFocused();

  // Sending carries the excerpt as a blockquote ahead of what was typed, and the chip goes.
  await composer.fill("Why did it pass?");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(`> ${SENTENCE}`)).toBeVisible();
  await expect(chip).toHaveCount(0);
});

test("an open selection menu holds a live reply's auto-follow, and closing it catches up", async ({
  page,
}) => {
  // A short window, so the conversation overflows it and following actually has to scroll.
  await page.setViewportSize({ width: 1280, height: 640 });
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const sess = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
    })
  ).json();

  await page.goto(`${BASE}/chat/${sess.session.sessionId}`);
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.waitFor();
  // A first round fills the view: the mock's tool call and its long reply.
  await composer.fill("check the directory");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible({ timeout: 30_000 });

  // The live reply: "slow text test" streams chunk-1 … chunk-40, one every 200ms.
  await composer.fill("slow text test");
  await page.getByRole("button", { name: "发送" }).click();
  const liveReply = page.getByText(/chunk-3 /).first();
  await expect(liveReply).toBeVisible({ timeout: 30_000 });

  /** The main stream's scroll position (outline.spec reaches the container the same way). */
  const metrics = () =>
    page.evaluate(() => {
      const c = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
      return {
        top: c.scrollTop,
        height: c.scrollHeight,
        fromBottom: c.scrollHeight - c.scrollTop - c.clientHeight,
      };
    });
  /** How many chunks the live reply shows so far. */
  const chunks = () =>
    page.evaluate(() => {
      const found = document.body.innerText.match(/chunk-(\d+)/g) ?? [];
      return found.length === 0 ? 0 : Math.max(...found.map((c) => Number(c.slice(6))));
    });

  // Following: the view rides the bottom as chunks arrive.
  await expect.poll(async () => (await metrics()).fromBottom).toBeLessThanOrEqual(1);

  // Select the prompt of the live round and right-click it with the mouse alone — a locator
  // click would first scroll the target into view. Retried: a snap's scroll event from just
  // before the click can still land after the menu opened, and a scroll that moves the menu's
  // anchor closes it, which is the behaviour the hold must not take away from the user.
  const addRow = page.getByRole("button", { name: "添加到对话", exact: true });
  await expect(async () => {
    const at = await page.evaluate(() => {
      const stream = document.querySelector("[data-outline-anchor]").closest(".overflow-y-auto");
      const p = [...stream.querySelectorAll("p")].find(
        (el) => el.textContent?.trim() === "slow text test",
      );
      if (!p) throw new Error("prompt bubble not found");
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const r = p.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(at.x, at.y, { button: "right" });
    await expect(addRow).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  /** Where the menu panel is pinned (its fixed viewport coordinates). */
  const pinnedAt = () =>
    addRow.evaluate((row) => {
      const panel = row.parentElement;
      return { left: panel.style.left, top: panel.style.top, bottom: panel.style.bottom };
    });
  const menuAt = await pinnedAt();
  const held = await metrics();
  const chunksAtOpen = await chunks();

  // Chunks keep arriving under the open menu until the content has grown: the view stays
  // where it was — no longer at the bottom — and the menu stays open where it opened.
  await expect
    .poll(async () => (await metrics()).height, { timeout: 7_000 })
    .toBeGreaterThan(held.height);
  expect(await chunks()).toBeGreaterThan(chunksAtOpen);
  await expect(addRow).toBeVisible();
  expect(await pinnedAt()).toEqual(menuAt);
  const during = await metrics();
  expect(during.top).toBe(held.top);
  expect(during.fromBottom).toBeGreaterThan(1);

  // Closing the menu resumes following: the view catches up to the bottom.
  await page.keyboard.press("Escape");
  await expect(addRow).toHaveCount(0);
  await expect.poll(async () => (await metrics()).fromBottom).toBeLessThanOrEqual(1);
});
