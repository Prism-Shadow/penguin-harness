import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const base = process.env.BASE_URL;
const providers = ["custom", "deepseek"];
const recognition = "deepseek-asr";
const synthesis = "deepseek-tts";

async function search(page, model) {
  await page.getByPlaceholder(/Search models|搜索模型/).fill(model);
}
function card(page, name) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="name"]').filter({ hasText: name }) });
}
async function switchProject(page, from, to) {
  await page.getByRole("button", { name: from, exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp("^" + to) })
    .first()
    .click();
  await expect(page.getByRole("button", { name: to, exact: true })).toBeVisible();
}
test("Models opens the project’s multimodal defaults, which persist across reloads and stay scoped to that project", async ({
  page,
  context,
  browser,
}) => {
  const user = "cardselection";
  await provisionAndLogin(page.request, user, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const a = (await (await page.request.get(base + "/api/projects")).json()).projects[0].projectId;
  const b = user + "-second";
  expect(
    (await page.request.patch(base + "/api/projects/" + a, { data: { name: "Cards Alpha" } })).ok(),
  ).toBeTruthy();
  const created = await page.request.post(base + "/api/projects", {
    data: { projectId: b, name: "Cards Beta" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  for (const project of [a, b]) {
    const models = providers.flatMap((provider, index) =>
      [recognition, synthesis].map((modelId) => ({
        provider,
        modelId,
        displayName:
          (index ? "Lake " : "River ") + (modelId === recognition ? "recognition" : "synthesis"),
        contextWindow: 32000,
        clientType: "mmsp",
        apiKey: "local-test",
        baseUrl: process.env.MOCK_URL + "/v1",
      })),
    );
    models.push({
      provider: "custom",
      modelId: "note-editor",
      displayName: "Project writer",
      clientType: "mmsp",
      contextWindow: 32000,
      vision: true,
      baseUrl: process.env.MOCK_URL + "/v1",
      apiKey: "local-test",
    });
    const put = await page.request.put(base + "/api/projects/" + project + "/models", {
      data: { models },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
  }
  const settings = async (project) =>
    (
      await (
        await page.request.get(base + "/api/projects/" + project + "/capabilities/tools")
      ).json()
    ).bindings;
  await page.addInitScript((project) => {
    if (!localStorage.getItem("penguin.lastProjectId"))
      localStorage.setItem("penguin.lastProjectId", project);
  }, a);
  const open = async (target) => {
    await target
      .getByRole("button", { name: /^(Default multimodal models|默认多模态模型)$/ })
      .click();
    await expect(
      target.getByRole("heading", { name: /^(Default multimodal models|默认多模态模型)$/ }),
    ).toBeVisible();
  };
  const field = (target, label) =>
    target.getByRole("dialog").first().getByRole("button", { name: label, exact: true });
  const choose = async (target, label, option) => {
    await field(target, label).click();
    await target
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: option, exact: true })
      .click();
  };
  const polish = async (project) =>
    (
      await (
        await page.request.get(base + "/api/projects/" + project + "/capabilities/tools")
      ).json()
    ).voicePolish;
  await page.goto(base + "/models");
  await search(page, recognition);
  await expect(card(page, "River recognition").getByRole("button")).toHaveCount(1);
  await open(page);
  await expect(page).toHaveURL(/projectSettings=multimodal/);
  await expect(field(page, "Image generation")).toBeDisabled();
  await expect(field(page, "Speech recognition")).toContainText("Not assigned");
  const other = await context.newPage();
  await other.goto(page.url());
  await choose(page, "Speech recognition", recognition + " (custom)");
  await expect(field(other, "Speech recognition")).toContainText(recognition + " (custom)");
  await choose(page, "Speech recognition", recognition + " (deepseek)");
  await expect(field(other, "Speech recognition")).toContainText(recognition + " (deepseek)");
  await expect
    .poll(() => settings(a))
    .toEqual({ s2t: { provider: "deepseek", modelId: recognition } });
  expect(await settings(b)).toEqual({});
  await choose(page, "Speech synthesis", synthesis + " (custom)");
  await choose(page, "Text generation", "note-editor (custom)");
  await choose(page, "Image understanding", "note-editor (custom)");
  const originalPrompt = (await polish(a)).defaultPrompt;
  const prompt = page.getByRole("textbox", { name: "Editing instructions" });
  await field(page, "Polish dictation").click();
  await expect(page.getByText("Enable in Cards Alpha")).toBeVisible();
  await expect(prompt).toHaveValue(originalPrompt);
  await prompt.fill("Keep project names. Preserve all line breaks.");
  await page.getByRole("switch", { name: "Polish dictation" }).click();
  await expect.poll(() => polish(a)).toMatchObject({ enabled: true, prompt: originalPrompt });
  const settingsRoute = "**/api/projects/" + a + "/capabilities/tools";
  let rejected = false;
  await page.route(settingsRoute, async (route) => {
    // A save first checks the live project settings before sending the change.
    if (!rejected && route.request().method() === "GET") {
      rejected = true;
      return route.fulfill({ status: 503, json: { error: "Save failed" } });
    }
    return route.continue();
  });
  await field(page, "Save").click();
  await expect.poll(() => rejected).toBe(true);
  await expect(field(page, "Save")).toBeEnabled();
  await expect(prompt).toHaveValue("Keep project names. Preserve all line breaks.");
  await page.unroute(settingsRoute);
  await field(page, "Save").click();
  await expect
    .poll(() => polish(a))
    .toMatchObject({ enabled: true, prompt: "Keep project names. Preserve all line breaks." });
  expect((await polish(b)).prompt).toBe(originalPrompt);
  await page.reload();
  await expect(field(page, "Speech recognition")).toContainText(recognition + " (deepseek)");
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/defaults-en.png",
    });
  await page.getByRole("button", { name: /^Polish dictation/ }).click();
  await expect(prompt).toHaveValue("Keep project names. Preserve all line breaks.");
  await field(page, "Restore default instructions").click();
  await expect(prompt).toHaveValue(originalPrompt);
  await field(page, "Save").click();
  await expect.poll(() => polish(a)).toMatchObject({ enabled: true, prompt: originalPrompt });
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(field(page, "Image understanding")).toContainText("note-editor (custom)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switchProject(page, "Cards Alpha", "Cards Beta");
  await page.getByRole("button", { name: "Cards Beta", exact: true }).click();
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  await expect(page).toHaveURL(/projectSettings=general/);
  await field(page, "Default multimodal models").click();
  await expect(page).toHaveURL(/projectSettings=multimodal/);
  await page.reload();
  await expect(field(page, "Speech recognition")).toContainText("Not assigned");
  await choose(page, "Speech recognition", recognition + " (custom)");
  await expect
    .poll(() => settings(b))
    .toEqual({ s2t: { provider: "custom", modelId: recognition } });
  await choose(page, "Speech recognition", "Not assigned");
  await expect.poll(() => settings(b)).toEqual({});
  await page.keyboard.press("Escape");
  await switchProject(page, "Cards Beta", "Cards Alpha");
  await setAccountPrefs(page.request, { lang: "zh" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await open(page);
  await expect(field(page, "语音识别")).toContainText(recognition + " (deepseek)");
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/defaults-zh-phone.png",
    });
  await page.getByRole("button", { name: /^润色语音输入/ }).click();
  await expect(page.getByRole("switch", { name: "润色语音输入" })).toBeChecked();
  await page.getByRole("textbox", { name: "润色提示词" }).scrollIntoViewIfNeeded();
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/polish-zh-phone.png",
    });
  const member = await browser.newContext();
  try {
    const reader = "cardreader";
    await provisionAndLogin(member.request, reader, "password123");
    await setAccountPrefs(member.request, { lang: "en" });
    const add = await page.request.post(base + "/api/projects/" + a + "/members", {
      data: { userId: reader },
    });
    expect(add.ok(), await add.text()).toBeTruthy();
    const memberPage = await member.newPage();
    await memberPage.addInitScript(
      (project) => localStorage.setItem("penguin.lastProjectId", project),
      a,
    );
    await memberPage.goto(base + "/models");
    await open(memberPage);
    await expect(field(memberPage, "Speech recognition")).toContainText(
      recognition + " (deepseek)",
    );
    await expect(field(memberPage, "Speech recognition")).toBeDisabled();
    expect(
      (
        await member.request.patch(base + "/api/projects/" + a + "/capabilities/tools", {
          data: { bindings: { s2t: null } },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await member.close();
  }
  await other.close();
});
