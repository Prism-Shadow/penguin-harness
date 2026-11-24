/**
 * Narrow viewport (<1024px, the dock store's merge breakpoint): the right and bottom
 * docks render as ONE merged bottom surface — a 320px-minimum right panel does not fit a
 * phone. Pulling open a dock lands on the merged surface's picker; picking the Workspace
 * opens its tab there; drilling into a directory and opening a Markdown file renders the
 * preview; the dock's × puts the whole surface away.
 * A short phone with a composer notice can still open a panel, reach its actions, and return to its draft.
 * Slash rows remain tappable, and the focused text and Close stay visible when a keyboard reduces
 * the layout viewport or only the visual viewport.
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

for (const browserName of ["webkit", "chromium"]) {
  const phoneTest = test.extend({
    browserName: [browserName, { scope: "worker", option: true }],
    permissions: [],
    isMobile: true,
    hasTouch: true,
  });
  phoneTest(
    browserName + ": slash choices, the focused draft and Close stay reachable above the keyboard",
    async ({ page, browser }) => {
      expect(browser.browserType().name()).toBe(browserName);
      await page.setViewportSize({ width: 320, height: 568 });
      await openSessionWithNotes(page, "phonekeyboard" + browserName);
      const field = page.locator('[data-slot="composer"] textarea').first();
      const dock = page.locator('[data-testid="dock"][data-position="bottom"][data-open="true"]');
      await page.getByTestId("dock-toggle-bottom").tap();
      await field.tap();
      await field.fill("/agent");
      await field.press("Enter");
      const agentSearch = page.getByPlaceholder(/Search agents/);
      await expect(agentSearch).toBeFocused();
      await agentSearch.dispatchEvent("keydown", { key: "Escape", isComposing: true });
      await expect(agentSearch).toBeFocused();
      await agentSearch.press("Escape");
      await expect(field).toBeFocused();
      await field.fill("/");
      await page.getByRole("button", { name: /^\/goal\b/ }).tap();
      await expect(field).toHaveValue("");
      await field.fill("Keep editing");
      await field.tap();
      // Safari keeps its layout viewport at the page height when its keyboard covers the bottom.
      // Chromium can resize the layout itself. The visible editing and close targets must agree.
      if (browserName === "webkit") {
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport, "height", {
            configurable: true,
            get: () => 360,
          });
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
      } else {
        await page.setViewportSize({ width: 320, height: 360 });
      }
      const hit = (locator) =>
        locator.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          return (
            y >= 0 &&
            y < window.visualViewport.height &&
            el.contains(document.elementFromPoint(x, y))
          );
        });
      await expect.poll(() => hit(field)).toBe(true);
      await expect.poll(() => hit(dock.getByTestId("dock-close"))).toBe(true);
      await expect(field).toBeFocused();
      await field.press("End");
      await page.keyboard.type(" on this phone");
      await expect(field).toHaveValue("Keep editing on this phone");
      const longDraft = Array.from({ length: 12 }, (_, i) => `Draft line ${i + 1}`).join("\n");
      await field.fill(longDraft);
      await field.press("Control+End");
      await page.keyboard.type(" done");
      await expect
        .poll(() =>
          field.evaluate((el) => {
            const field = el.getBoundingClientRect();
            const composer = el.closest(".dock-composer-scroll").getBoundingClientRect();
            // Chromium leaves the bottom padding and some line leading below the caret.
            const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
            return (
              field.top >= composer.top - 1 &&
              field.bottom <= composer.bottom + 1 &&
              el.selectionEnd === el.value.length &&
              el.scrollHeight - el.scrollTop - el.clientHeight < lineHeight / 2
            );
          }),
        )
        .toBe(true);
      await dock.getByTestId("dock-pick-workspace").tap();
      await expect(dock.getByRole("tab", { name: /Files/ })).toBeInViewport();
      await dock.getByTestId("dock-close").tap();
      await expect(dock).toHaveCount(0);
      await expect(field).toHaveValue(longDraft + " done");
    },
  );
}
