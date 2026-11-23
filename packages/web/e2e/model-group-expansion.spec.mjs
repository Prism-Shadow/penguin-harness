import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const provider = createServer((req, res) => {
  if (req.method !== "GET" || req.url !== "/v1/models") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: [{ id: "single-test-model", object: "model" }] }));
});
test.beforeAll(async () => {
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await new Promise((resolve) => provider.close(resolve));
});

test("model groups remember manual toggles while search and import leave them alone", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "modelgroups", "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const key = "penguin.modelsExpandedGroups." + projects[0].projectId;
  const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  await page.goto("/models");
  const toggles = page.locator('[data-slot="group"] button[aria-expanded]').filter({
    has: page.locator('[data-slot="name"]'),
  });
  const deepSeek = toggles.filter({ hasText: "DeepSeek" });
  await expect(deepSeek).toBeVisible();
  await expect(toggles.and(page.locator('[aria-expanded="true"]'))).toHaveCount(0);
  expect(await saved()).toBeNull();

  await deepSeek.focus();
  await page.keyboard.press("Enter");
  await expect(deepSeek).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(deepSeek).toHaveAttribute("aria-expanded", "true");
  expect(await saved()).toEqual(["deepseek"]);

  const search = page.getByPlaceholder("Search models: id / name / provider");
  await search.fill("openrouter");
  const openRouter = toggles.filter({ hasText: "OpenRouter" });
  await expect(openRouter).toHaveAttribute("aria-expanded", "true");
  await search.fill("");
  await expect(openRouter).toHaveAttribute("aria-expanded", "false");
  await expect(deepSeek).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: /Add group$/ }).click();
  const form = page.getByRole("dialog", { name: "Add group" });
  await form.getByPlaceholder(/^Starts with a lowercase/).fill("test-import");
  await form.getByText("Import models", { exact: true }).click();
  await form
    .getByPlaceholder("Enter a base URL")
    .fill(`http://127.0.0.1:${provider.address().port}/v1`);
  await form.getByPlaceholder(/endpoint.s API key/).fill("fixture");
  await form.getByRole("button", { name: /^Protocol:/ }).click();
  await page.getByRole("menuitemradio", { name: /OpenAI Chat Completions/ }).click();
  await form.getByRole("button", { name: "Fetch model list" }).click();
  await form.getByRole("button", { name: "Import 1 model" }).click();
  await expect(form).toBeHidden();

  const imported = toggles.filter({ hasText: "test-import" });
  await expect(imported).toHaveAttribute("aria-expanded", "false");
  expect(await saved()).toEqual(["deepseek"]);
  await page.locator('[data-slot="fold"]').click();
  await imported.click();
  await expect(imported).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(imported).toHaveAttribute("aria-expanded", "true");
  await expect(deepSeek).toHaveAttribute("aria-expanded", "true");
});
