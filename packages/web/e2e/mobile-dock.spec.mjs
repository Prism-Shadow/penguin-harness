/**
 * Narrow viewport (<1024px, the dock store's merge breakpoint): the right and bottom
 * docks render as ONE merged bottom surface — a 320px-minimum right panel does not fit a
 * phone. Pulling open a dock lands on the merged surface's start page; picking the Workspace
 * opens its tool there; drilling into a directory and opening a Markdown file renders the
 * preview; closing the tool's tab leaves the surface open on its start page, and the dock's ×
 * puts the whole surface away.
 * A short phone with a composer notice can still open a panel, reach its actions, and return to its draft.
 * With both initial notices, opening Files from Shortcuts exposes a whole row before any scroll, and more files can be reached below it.
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

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

async function openSessionWithNotes(page, user, paths = ["notes/demo.md"]) {
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
  for (const path of paths) {
    const up = await page.request.put(
      `${BASE}/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`,
      { data: { dataBase64: md } },
    );
    expect(up.ok(), "upload " + path).toBeTruthy();
  }

  await page.goto(`${BASE}/chat/${sessionId}`);
  return sessionId;
}

test("mobile merged dock: workspace opens at the bottom → nested dir → md rendered preview → × hides", async ({
  page,
}) => {
  const sessionId = await openSessionWithNotes(page, "sheetuser");
  // Pull open the right dock: at this width it renders as the merged bottom surface, whose
  // start page then opens the Workspace tool (its tab still records its right-dock home).
  await page.getByTestId("dock-toggle-right").click();

  // One merged bottom surface, never a right dock at this width.
  const dock = page.locator('[data-testid="dock"][data-position="bottom"]');
  await expect(dock).toBeVisible();
  // Absent, not hidden: a hidden dock would still be in the DOM (at zero size, keeping its
  // panels), while at this width there is no right surface to render at all.
  await expect(page.locator('[data-testid="dock"][data-position="right"]')).toHaveCount(0);
  await dock.getByTestId("dock-pick-workspace").click();
  const files = dock.locator(
    '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/workspace/"]',
  );
  await expect(files).toHaveAttribute("data-active", "true");
  // The tool has an address of its own beside the conversation; resizing never leaves it.
  const address = page.url();
  expect(address).toContain(`beside=${sessionId}`);

  // Drill into the directory → open the md → default rendered view (h1 shown, not source).
  await dock.getByText("notes").first().click();
  await dock.getByText("demo.md").first().click();
  await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeVisible();

  // The same open file stays in the merged dock through a touch drag beyond its upper bound.
  const divider = await dock.getByTestId("dock-resizer").boundingBox();
  const touch = await page.context().newCDPSession(page);
  const x = Math.round(divider.x + divider.width / 2);
  const y = Math.round(divider.y + divider.height / 2);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const top of [y - 12, y - 32, 1])
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: top }],
    });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  await expect(dock).not.toHaveAttribute("data-fullscreen");
  await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeVisible();
  await expect(page).toHaveURL(address);
  const toolbar = page.locator("[data-session-toolbar]");
  expect((await dock.boundingBox()).y).toBeGreaterThan(
    (await toolbar.boundingBox()).y + (await toolbar.boundingBox()).height,
  );
  await dock.getByTestId("dock-fullscreen").tap();
  await expect(dock).toHaveAttribute("data-fullscreen", "full");
  await dock.getByTestId("dock-fullscreen").tap();
  await expect(dock).not.toHaveAttribute("data-fullscreen");
  await page.setViewportSize({ width: 1023, height: 850 });
  await expect(page.locator('[data-testid="dock"][data-position="right"]')).toHaveCount(0);
  await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeVisible();

  // Closing the tool's tab leaves the surface open on its start page; the dock's × puts the
  // surface away, and the toolbar toggle reads closed again.
  await files.getByTestId("dock-tab-close").click();
  await expect(dock.getByTestId("dock-picker")).toBeVisible();
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

async function setKeyboardHeight(page, browserName, height) {
  // Safari keeps the layout viewport, while Chromium can resize the layout itself.
  if (browserName === "webkit") {
    await page.evaluate((height) => {
      Object.defineProperty(window.visualViewport, "height", {
        configurable: true,
        get: () => height,
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    }, height);
  } else {
    await page.setViewportSize({ width: page.viewportSize().width, height });
  }
}

for (const browserName of ["webkit", "chromium"]) {
  const phoneTest = test.extend({
    browserName: [browserName, { scope: "worker", option: true }],
    permissions: [],
    isMobile: true,
    hasTouch: true,
  });
  phoneTest(
    browserName + ": Files opens with a whole tappable row while both composer notices are present",
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await openSessionWithNotes(page, "phonedirectory" + browserName, ["a.md", "b.md", "c.md"]);
      await expect(page.getByText(/using its initial password/)).toBeVisible();
      await expect(page.getByText(/compaction threshold/).first()).toBeVisible();

      await page.getByRole("button", { name: "Shortcuts", exact: true }).tap();
      await page.getByTestId("dock-launcher-open-workspace").tap();
      const dock = page.locator('[data-testid="dock"][data-position="bottom"][data-open="true"]');
      // Check before the tap: Playwright can otherwise scroll a clipped target into position.
      const first = dock.getByRole("treeitem", { name: /a\.md/ });
      await expect(first).toBeInViewport({ ratio: 1 });
      await first.tap();
      const back = dock.getByRole("button", { name: "Back to list" });
      await back.tap();
      const file = dock.getByRole("treeitem", { name: /c\.md/ });
      await file.scrollIntoViewIfNeeded();
      await expect(file).toBeInViewport({ ratio: 1 });
      await file.tap();
      await expect(dock.getByRole("heading", { name: "Sheet Heading" })).toBeInViewport();
      await back.tap();
      await expect(dock.getByRole("tree")).toBeVisible();
    },
  );
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
      await setKeyboardHeight(page, browserName, 360);
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

  phoneTest(
    browserName + ": shrinking an existing draft keeps the edited line or the reader's place",
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await openSessionWithNotes(page, "phonecaret" + browserName);
      const field = page.locator('[data-slot="composer"] textarea').first();
      await page.getByTestId("dock-toggle-bottom").tap();
      await field.tap();
      for (const position of ["last", "middle", "reading"]) {
        await setKeyboardHeight(page, browserName, 667);
        const lines = Array.from({ length: 18 }, (_, index) => `Row ${index + 1}`);
        // Make the middle caret cross a soft wrap as well as explicit line breaks.
        if (position === "middle") lines[1] = "wrapped word ".repeat(12);
        await field.fill(lines.join("\n"));
        let line = 17;
        if (position === "middle") {
          line = 9;
          await field.press("Control+Home");
          for (let i = 0; i < line; i++) await field.press("ArrowDown");
        } else {
          await field.press("Control+End");
        }
        await page.keyboard.type("x");
        const before = await field.evaluate((el) => ({
          value: el.value,
          start: el.selectionStart,
          end: el.selectionEnd,
          height: el.clientHeight,
        }));
        const lineVisible = () =>
          field.evaluate((el, line) => {
            const style = getComputedStyle(el);
            const h = parseFloat(style.lineHeight);
            const center = parseFloat(style.paddingTop) + (line + 0.5) * h - el.scrollTop;
            const halfEm = parseFloat(style.fontSize) / 2;
            return center >= halfEm && center <= el.clientHeight - halfEm;
          }, line);
        await expect.poll(lineVisible).toBe(true);
        if (position === "reading")
          await field.evaluate((el) => {
            el.scrollTop = 0;
          });
        await setKeyboardHeight(page, browserName, 360);
        await expect
          .poll(() => field.evaluate((el) => el.clientHeight))
          .toBeLessThan(before.height);
        // Check before any focus, selection or typing event could reveal the caret itself.
        if (position === "reading")
          await expect.poll(() => field.evaluate((el) => el.scrollTop)).toBe(0);
        else await expect.poll(lineVisible).toBe(true);
        expect(
          await field.evaluate((el) => [el.value, el.selectionStart, el.selectionEnd]),
        ).toEqual([before.value, before.start, before.end]);
        await expect(field).toBeFocused();
      }
    },
  );
}
