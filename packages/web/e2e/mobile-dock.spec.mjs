/**
 * Narrow viewport (<1024px, the dock store's merge breakpoint): the right and bottom
 * docks render as ONE merged bottom surface — a 320px-minimum right panel does not fit a
 * phone. Pulling open a dock lands on the merged surface's picker; picking the Workspace
 * opens its tab there; drilling into a directory and opening a Markdown file renders the
 * preview; the dock's × puts the whole surface away.
 * A short phone with a composer notice can still open a panel, reach its actions, and return to its draft.
 * Upload uses a nested path (notes/demo.md): also covers the server's sandbox
 * auto-creating a missing parent directory.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;

test.use({ viewport: { width: 412, height: 915 } });

async function openSessionWithNotes(page, user) {
  await provisionAndLogin(page.request, user, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
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
}

test("mobile merged dock: workspace opens at the bottom → nested dir → md rendered preview → × hides", async ({
  page,
}) => {
  await openSessionWithNotes(page, "sheetuser");
  // Pull open the right dock: at this width it renders as the merged bottom surface,
  // whose picker then opens the Workspace (the tab still records its right-dock home).
  await page.getByTestId("dock-toggle-right").click();

  // One merged bottom surface, never a right dock at this width.
  const dock = page.locator('[data-testid="dock"][data-position="bottom"]');
  await expect(dock).toBeVisible();
  // Absent, not hidden: a hidden dock would still be in the DOM (at zero size, keeping its
  // panels), while at this width there is no right surface to render at all.
  await expect(page.locator('[data-testid="dock"][data-position="right"]')).toHaveCount(0);
  await dock.getByTestId("dock-pick-workspace").click();
  await expect(dock.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();

  // Drill into the directory → open the md → default rendered view (h1 shown, not source).
  await dock.getByText("notes").first().click();
  await dock.getByText("demo.md").first().click();
  await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeVisible();

  // The dock's × puts the surface away; the toolbar toggle reads closed again.
  await dock.getByTestId("dock-close").click();
  await expect(dock).toBeHidden();
  await expect(page.getByTestId("dock-toggle-right")).toHaveAttribute("aria-expanded", "false");
});

test.describe("short touch viewport", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 568 } });

  test("tapping either toolbar button opens a usable panel while a notice shares the composer", async ({
    page,
  }) => {
    await openSessionWithNotes(page, "shortdockuser");
    const composer = page.locator('[data-slot="composer"] textarea').first();
    const draft = "Keep my notes while inspecting the workspace.";
    await composer.fill(draft);
    const notice = page.getByRole("button", { name: "Open agent settings", exact: true });
    await expect(notice).toBeVisible();
    const dock = page.locator('[data-testid="dock"][data-position="bottom"][data-open="true"]');
    await page.getByTestId("dock-toggle-right").tap();
    const choices = dock.getByTestId("dock-picker").getByRole("button");
    await expect(choices.first()).toBeInViewport({ ratio: 0.8 });
    await choices.last().scrollIntoViewIfNeeded();
    await expect(choices.last()).toBeInViewport({ ratio: 0.8 });
    await dock.getByTestId("dock-pick-workspace").tap();
    await dock.getByText("notes", { exact: true }).tap();
    await dock.getByText("demo.md", { exact: true }).tap();
    await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeInViewport();
    await dock.getByTestId("dock-close").tap();
    await page.getByTestId("dock-toggle-bottom").tap();
    await dock.getByTestId("dock-add").tap();
    await page.getByTestId("dock-add-memory").tap();
    await expect(dock.getByRole("tab", { name: /Memory/ })).toBeInViewport();
    await page.setViewportSize({ width: 568, height: 320 });
    await dock.getByTestId("dock-close").tap();
    await expect(dock).toHaveCount(0);
    await expect(composer).toHaveValue(draft);
    await expect(notice).toBeVisible();
  });
});
