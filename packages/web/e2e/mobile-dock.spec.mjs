/**
 * Narrow viewport (<1024px, the dock store's merge breakpoint): the right and bottom
 * docks render as ONE merged bottom surface — a 320px-minimum right panel does not fit a
 * phone. Opening the Workspace lands its tab there; drilling into a directory and opening
 * a Markdown file renders the preview; the dock's × puts the whole surface away.
 * Upload uses a nested path (notes/demo.md): also covers the server's sandbox
 * auto-creating a missing parent directory.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test.use({ viewport: { width: 412, height: 915 } });

test("mobile merged dock: workspace opens at the bottom → nested dir → md rendered preview → × hides", async ({
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

  const md = Buffer.from("# Sheet Heading\n\nBody paragraph.").toString("base64");
  const up = await page.request.put(
    `${BASE}/api/sessions/${sessionId}/files/content?path=notes/demo.md`,
    { data: { dataBase64: md } },
  );
  expect(up.ok(), "upload nested md").toBeTruthy();

  await page.goto(`${BASE}/chat/${sessionId}`);
  await page.getByRole("button", { name: "打开工作区" }).click();

  // One merged bottom surface, never a right dock at this width.
  const dock = page.locator('[data-testid="dock"][data-position="bottom"]');
  await expect(dock).toBeVisible();
  await expect(page.locator('[data-testid="dock"][data-position="right"]')).toHaveCount(0);
  await expect(dock.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();

  // Drill into the directory → open the md → default rendered view (h1 shown, not source).
  await dock.getByText("notes").first().click();
  await dock.getByText("demo.md").first().click();
  await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeVisible();

  // The dock's × puts the surface away; the toolbar trigger reads closed again.
  await dock.getByTestId("dock-close").click();
  await expect(dock).toBeHidden();
  await expect(page.getByRole("button", { name: "打开工作区" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
