// A deck started in the app center and reopened full screen keeps one Session and history.
// Pick a different model after the first reply; the provider reports which upstream it received.
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
const BASE = process.env.BASE_URL;
test("choosing a model in Slides changes only the presentation's next turn", async ({ page }) => {
  await provisionAndLogin(page.request, "bentomodeluser", "password123");
  const { projects } = await (await page.request.get(BASE + "/api/projects")).json();
  const project = projects[0].projectId;
  const projectApi = BASE + "/api/projects/" + project;
  const first = "claude-bento-first",
    second = "claude-bento-second";
  const models = [first, second].map((modelId) => ({
    modelId,
    displayName: modelId === first ? "Draft" : "Review",
    provider: "custom",
    apiKey: "sk-mock",
    baseUrl: process.env.MOCK_URL,
    contextWindow: 200000,
  }));
  const configured = await page.request.put(projectApi + "/models", {
    data: { defaultModel: { provider: "custom", modelId: first }, models },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  const installed = await page.request.post(projectApi + "/agents/default_agent/plugins", {
    data: { names: ["use-bento-slides"] },
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  await page.goto(BASE + "/apps");
  await page
    .getByRole("button", { name: /AI (PPT|Slides)/ })
    .first()
    .click();
  const app = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
  await app.locator("#start-sample").click();
  const ask = async (text) => {
    await app.locator("#prompt").fill(text);
    await app.locator("#send").click();
  };
  await ask("Check the cover");
  await expect(app.locator("#talk")).toContainText("Served by " + first, { timeout: 30000 });
  const wb = projectApi + "/agents/default_agent/workbenches/slides/api";
  const decks = await (await page.request.get(wb + "/decks")).json();
  const deckId = decks.decks[0].id;
  const session = async () =>
    (await (await page.request.get(wb + "/ask?deck=" + deckId)).json()).sessionId;
  const original = await session();
  await expect(app.locator("#chat-model button")).toContainText("Draft");

  await app.locator("#chat-model button").click();
  const picker = page.getByRole("dialog").last();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await page.goto(BASE + "/app/" + project + "/default_agent/slides/main");
  await app.locator("#recent-decks .file-row button").first().click();
  await app.locator("#chat-model button").click();
  await picker.getByText("Review", { exact: true }).click();
  await app.locator('#choice-confirm [value="switch"]').click();
  await expect(app.locator("#chat-model button")).toContainText("Review");
  await ask("Shorten slide two");
  await expect(app.locator("#talk")).toContainText("Served by " + second, { timeout: 30000 });
  await expect(app.locator("#talk")).toContainText("Check the cover");
  await expect(app.locator("#chat-model button")).toBeEnabled();
  expect(await session()).toBe(original);
  const catalog = await (await page.request.get(projectApi + "/models")).json();
  expect(catalog.defaultModel).toEqual({ provider: "custom", modelId: first });
  await page.reload();
  await app.locator("#recent-decks .file-row button").first().click();
  await expect(app.locator("#chat-model button")).toContainText("Review");
  await expect(app.locator("#talk")).toContainText("Served by " + second);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await app.locator("#chat-model button").click();
    await expect(picker.getByText("Review", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await app.locator("#app").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await app.locator("#show-decks").click();
  await app.locator("#start-model button").click();
  await picker.getByText("Review", { exact: true }).click();
  await app.locator("#start-prompt").fill("Plan a workshop");
  await app.locator("#start-ask button[type=submit]").click();
  await expect(app.locator("#talk")).toContainText("Served by " + second);
  await expect(app.locator("#talk")).not.toContainText("Check the cover");
  await expect(app.locator("#chat-model button")).toContainText("Review");
  expect((await (await page.request.get(projectApi + "/models")).json()).defaultModel).toEqual({
    provider: "custom",
    modelId: first,
  });
  await app.locator("#show-decks").click();
  await expect(app.locator("#start-model button")).toContainText("Draft");
});
