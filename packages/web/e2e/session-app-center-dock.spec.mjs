import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

async function seed(page, user, lang) {
  if (user === ADMIN_ID) await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  else await provisionAndLogin(page.request, user, "password123");
  await setAccountPrefs(page.request, { lang });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const project = "/api/projects/" + projects[0].projectId;
  const model = {
    provider: "custom",
    modelId: "claude-4-8",
    baseUrl: process.env.MOCK_URL,
    apiKey: "sk-mock",
    contextWindow: 200000,
  };
  await expect(
    await page.request.put(project + "/models", {
      data: { defaultModel: model, models: [model] },
    }),
  ).toBeOK();
  const created = await page.request.post(project + "/agents/default_agent/sessions", { data: {} });
  await expect(created).toBeOK();
  const { session } = await created.json();
  return session;
}

test("the catalog in a conversation opens a native app beside its original draft and returns", async ({
  page,
}) => {
  const session = await seed(page, "dockedcatalog", "en");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/chat/" + session.sessionId);
  const chat = page.locator('[data-workspace-page="chat:' + session.sessionId + '"]');
  const composer = chat.locator('[data-slot="composer"] textarea').first();
  await composer.fill("Keep my notes while browsing");
  await chat.locator('input[type="file"]:not([accept])').setInputFiles({
    name: "outline.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Keep this attachment"),
  });
  await chat.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await chat.getByRole("button", { name: "Open App Center", exact: true }).click();
  const catalog = page.locator('[data-workspace-page="catalog"]');
  const modelsTile = catalog.locator('li[data-app="system_agent/models"] > button').first();
  await expect(catalog).toHaveAttribute("data-pane", "right");
  await modelsTile.focus();
  await page.keyboard.press("Enter");
  const models = page.locator('[data-workspace-page="app:system_agent/models"]');
  await expect(models).toHaveAttribute("data-pane", "right");
  await expect(models.getByRole("heading").first()).toBeVisible();
  await expect(chat).toHaveAttribute("data-pane", "left");
  await expect(composer).toHaveValue("Keep my notes while browsing");
  await expect(chat.getByText("outline.txt", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(modelsTile).toBeVisible();
  await expect(catalog).toHaveAttribute("data-pane", "right");
  await page
    .getByRole("complementary")
    .getByRole("link", { name: /^App Center/ })
    .click();
  await expect(catalog).toHaveAttribute("data-pane", "full");
  await expect(page).toHaveURL(/\/apps$/);
  await modelsTile.click();
  await expect(models).toHaveAttribute("data-pane", "full");
});

for (const lang of ["en", "zh"]) {
  test(`the right dock and Shortcuts offer the same actions and keep the narrow catalog usable in ${lang}`, async ({
    page,
  }) => {
    const session = await seed(page, "dock_actions_" + lang, lang);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/chat/" + session.sessionId);
    const chat = page.locator('[data-workspace-page="chat:' + session.sessionId + '"]');
    const composer = chat.locator('[data-slot="composer"] textarea').first();
    await composer.fill("Draft from the original Session");
    await chat
      .getByRole("button", { name: lang === "en" ? "Shortcuts" : "快捷方式", exact: true })
      .click();
    const fan = chat.locator(
      '[data-testid^="dock-launcher-open-"],[data-testid="dock-launcher-hide"]',
    );
    const labels = (node) =>
      node.evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("aria-label") || row.textContent.trim()),
      );
    const choices = await labels(fan);
    const launch = chat.getByTestId("dock-launcher-open-app-center");
    await launch.focus();
    await page.keyboard.press("Enter");
    const catalog = page.locator('[data-workspace-page="catalog"][data-pane="right"]');
    const models = catalog.locator('li[data-app="system_agent/models"] > button').first();
    await expect(models).toBeVisible();
    const handle = chat.getByTestId("dock-resizer").filter({ visible: true }).first();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 245, box.y + 40, { steps: 10 });
    await page.mouse.up();
    const bounds = await catalog.evaluate((root) => {
      const scroller = root.querySelector("[data-app-center-scroll]");
      const first = root.querySelector("li[data-app] > button");
      return {
        w: scroller.clientWidth,
        overflow: scroller.scrollWidth - scroller.clientWidth,
        first: first.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      };
    });
    expect(bounds.w).toBeLessThan(380);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.first).toBeLessThan(100);
    const actions = catalog.getByRole("button", {
      name: lang === "en" ? "More actions" : "更多操作",
      exact: true,
    });
    await actions.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: lang === "en" ? "New folder" : "新建分组", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const add = chat.getByTestId("dock-add").filter({ visible: true }).first();
    await add.click();
    const rows = page.getByRole("menu").locator('[data-testid^="dock-add-"]');
    expect(await labels(rows)).toEqual(choices);
    await rows.first().focus();
    await page.keyboard.press("Enter");
    await expect(models).toBeVisible();
    const contributed = catalog.locator('li[data-app="default_agent/slides"] > button').first();
    await contributed.click();
    const frame = page.locator('[data-workspace-page^="app:"][data-pane="right"] iframe').first();
    await expect(frame).toBeVisible();
    const appBody = frame.contentFrame().locator("body");
    await appBody.evaluate((body) => {
      body.dataset.resizeCheck = "kept";
    });
    const location = page.url();
    const divider = chat.locator('[data-testid="dock-resizer"][aria-orientation="vertical"]');
    const dividerBox = await divider.boundingBox();
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2,
      dividerBox.y + dividerBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(1, dividerBox.y + dividerBox.height / 2, { steps: 6 });
    await page.mouse.move(dividerBox.x + 32, dividerBox.y + dividerBox.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(appBody).toHaveAttribute("data-resize-check", "kept");
    await expect(chat.locator('[data-position="right"][data-fullscreen]')).toHaveCount(0);
    expect(page.url()).toBe(location);
    await expect(composer).toHaveValue("Draft from the original Session");
    await add.click();
    await page.getByTestId("dock-add-app-center").click();
    await expect(models).toBeVisible();
    await expect(chat).toHaveAttribute("data-pane", "left");
  });
}

// Two Sessions can keep their own Browser Dock. Opening and revisiting the resource
// directories should give each directory one global row throughout those switches.
test("only an opened resource directory appears in Apps when two Sessions use Browser", async ({
  page,
}) => {
  const first = await seed(page, ADMIN_ID, "en");
  const created = await page.request.post(
    "/api/projects/" + first.projectId + "/agents/default_agent/sessions",
    { data: {} },
  );
  await expect(created).toBeOK();
  const { session: second } = await created.json();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/chat/" + first.sessionId);
  const sidebar = page.getByRole("navigation", { name: "Apps", exact: true });
  const appRows = sidebar.locator("[data-app-row]");
  const browser = "builtin-browser";
  const tab = (session) =>
    page.locator(
      '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/' +
        browser +
        '/"][data-tab-id$="/' +
        session.sessionId +
        '"]:visible',
    );
  const sessionRow = (session) =>
    page.locator('button[data-session-id="' + session.sessionId + '"]:visible');
  const shortcuts = page.getByRole("button", { name: "Shortcuts", exact: true });
  await shortcuts.click();
  await page.getByTestId("dock-launcher-open-" + browser).click();
  await expect(tab(first)).toBeVisible();
  await sessionRow(second).click();
  await shortcuts.click();
  await page.getByTestId("dock-launcher-open-workspace").click();
  await page.getByTestId("dock-add").filter({ visible: true }).click();
  await page.getByTestId("dock-add-" + browser).click();
  await expect(tab(second)).toBeVisible();
  const browserAddress = page.url();
  await expect(appRows).toHaveCount(0);

  const catalog = page.getByRole("complementary").getByRole("link", { name: /^App Center/ });
  for (const [index, kind] of [browser, "terminal"].entries()) {
    await catalog.click();
    const key = "system_agent/session-tools-" + kind;
    await page
      .locator('li[data-app="' + key + '"] > button')
      .first()
      .click();
    await expect(sidebar.locator('[data-app-row="' + key + '"]')).toBeVisible();
    await expect(appRows).toHaveCount(index + 1);
  }
  for (const session of [first, second, first]) {
    await sessionRow(session).click();
    await expect(tab(session)).toBeVisible();
    await expect(appRows).toHaveCount(2);
  }
  await tab(first).getByTestId("dock-tab-close").click();
  await expect(appRows).toHaveCount(2);
  await sessionRow(second).click();
  await expect(tab(second)).toBeVisible();
  await page.goto(browserAddress);
  await expect(tab(second)).toBeVisible();
  await page.reload();
  await expect(tab(second)).toBeVisible();
  await expect(appRows).toHaveCount(0);
});
