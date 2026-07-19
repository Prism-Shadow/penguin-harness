/**
 * Narrow viewport (<1024px, below use-files-panel's isDocked breakpoint): the Files panel
 * uses a bottom Sheet: open → drill into a directory → Markdown renders by default → Esc
 * closes and unmounts.
 * Upload uses a nested path (notes/demo.md): also covers the server's sandbox auto-creating
 * a missing parent directory.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test.use({ viewport: { width: 412, height: 915 } });

test("mobile Files sheet: open → nested dir → md rendered preview → esc close", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "sheetuser", "password123");
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

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
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const sessionId = sess.session.sessionId;

  const md = Buffer.from("# Sheet 标题\n\n正文段落。").toString("base64");
  const up = await page.request.put(
    `${BASE}/api/sessions/${sessionId}/files/content?path=notes/demo.md`,
    { data: { dataBase64: md } },
  );
  expect(up.ok(), "upload nested md").toBeTruthy();

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByRole("button", { name: "打开工作区" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  // Drill into the directory → open the md → default rendered view (h1 shown, not source).
  await sheet.getByText("notes").first().click();
  await sheet.getByText("demo.md").first().click();
  await expect(sheet.getByRole("heading", { name: "Sheet 标题" })).toBeVisible();

  // Esc closes: unmounts entirely once the exit animation finishes.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
