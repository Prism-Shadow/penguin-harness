import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

async function seed(page, user, lang) {
  await provisionAndLogin(page.request, user, "password123");
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
    await expect(
      page.locator('[data-workspace-page^="app:"][data-pane="right"] iframe').first(),
    ).toBeVisible();
    await expect(composer).toHaveValue("Draft from the original Session");
    await add.click();
    await page.getByTestId("dock-add-app-center").click();
    await expect(models).toBeVisible();
    await expect(chat).toHaveAttribute("data-pane", "left");
  });
}
