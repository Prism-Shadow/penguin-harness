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
