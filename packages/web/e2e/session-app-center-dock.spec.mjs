import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("the catalog in a conversation opens a native app beside its original draft and returns", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "dockedcatalog", "password123");
  await setAccountPrefs(page.request, { lang: "en" });
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
