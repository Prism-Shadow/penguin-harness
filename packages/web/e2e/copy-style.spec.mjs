/**
 * Copying selected text writes plain text alone, whichever way it is done (lib/selection-copy.ts).
 * In the dark theme, where the browser's own copy would inline the theme's light ink and grey
 * surfaces into an HTML flavour:
 * - ⌘C / Ctrl+C on a conversation selection (the prompt bubble through the reply, link and table
 *   included) puts exactly the selection's text on the clipboard, as text/plain and nothing else;
 * - the selection menu's Copy row writes the same single flavour with the same text;
 * - a selection in the Files panel's Markdown preview copies the same way;
 * - a selection inside the composer still copies the composer's own selection.
 * Not in CI's smoke list: run on demand (`test:e2e copy-style.spec.mjs`). The mock's default
 * branch drives it: one tool call, then the reply whose first paragraph is SENTENCE.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = "copystyleuser";
const P = "password123";
const PROMPT = "check the directory\nthen report back";
const SENTENCE = "Command finished; the result looks as expected.";

/** Every flavour on the clipboard, by type. */
const clipboard = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) out[type] = await (await item.getType(type)).text();
    }
    return out;
  });

const clear = (page) => page.evaluate(() => navigator.clipboard.writeText("(cleared)"));

/** Selects from the start of `from` to the end of `to` (CSS selector + text), returning what it reads. */
const selectBetween = (page, from, to) =>
  page.evaluate(
    ({ from, to }) => {
      const find = ({ selector, text }, last) => {
        const all = [...document.querySelectorAll(selector)].filter((el) =>
          (el.textContent ?? "").includes(text),
        );
        return last ? all.at(-1) : all[0];
      };
      const start = find(from, false);
      const end = find(to, true);
      if (!start || !end) throw new Error("selection ends not found");
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, end.childNodes.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    },
    { from, to },
  );

test("copying selected text writes plain text alone, from the keyboard and the menu alike", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { themeMode: "dark", themeId: "github" });
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
  const sessionId = (
    await (
      await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
        data: { provider: "custom", modelId: "claude-4-8", approvalMode: "allow-all" },
      })
    ).json()
  ).session.sessionId;
  const note = "# Notes\n\nA **bold** line with `code`.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
  const up = await page.request.put(
    `${BASE}/api/sessions/${sessionId}/files/content?path=notes.md`,
    { data: { dataBase64: Buffer.from(note).toString("base64") } },
  );
  expect(up.ok(), "upload notes.md").toBeTruthy();

  await page.goto(`${BASE}/chat/${sessionId}`);
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.waitFor();
  await composer.fill(PROMPT);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const reply = page.getByText(SENTENCE, { exact: true });
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".md-body table").last()).toBeVisible();

  // ⌘C on the conversation: the selection's text, and no HTML.
  const conversation = () =>
    selectBetween(
      page,
      { selector: "p", text: "then report back" },
      { selector: ".md-body", text: "completed" },
    );
  const selected = await conversation();
  expect(selected).toContain("then report back");
  expect(selected).toContain("completed");
  await clear(page);
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => clipboard(page)).toEqual({ "text/plain": selected });

  // The menu's Copy row writes the same.
  expect(await conversation()).toBe(selected);
  await clear(page);
  await reply.click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制", exact: true }).click();
  await expect(page.getByText("已复制")).toBeVisible();
  await expect.poll(() => clipboard(page)).toEqual({ "text/plain": selected });

  // A selection in the composer is the composer's own.
  await composer.fill("draft text for the composer");
  await composer.focus();
  await composer.evaluate((el) => el.setSelectionRange(6, 10));
  await clear(page);
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => clipboard(page)).toEqual({ "text/plain": "text" });
  await composer.fill("");

  // The Files panel's Markdown preview copies the same way as the conversation.
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-workspace").click();
  const dock = "[data-testid='dock'][data-position='right']";
  await page.locator(dock).getByText("notes.md").first().click();
  await expect(page.locator(`${dock} table`).first()).toBeVisible();
  const preview = await selectBetween(
    page,
    { selector: `${dock} h1`, text: "Notes" },
    { selector: `${dock} table`, text: "1" },
  );
  expect(preview).toContain("bold");
  await clear(page);
  await page.keyboard.press("ControlOrMeta+C");
  await expect.poll(() => clipboard(page)).toEqual({ "text/plain": preview });
});
