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
      data: { models, defaultModel: { provider: "custom", modelId: "note-editor" } },
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
    await target.getByRole("button", { name: /^(Multimodal models|多模态模型)$/ }).click();
    await expect(
      // The pane heading also holds the page's "?", whose name follows the title.
      target.getByRole("heading", { name: /^(Multimodal models|多模态模型)(\s|$)/ }),
    ).toBeVisible();
  };
  const field = (target, label) =>
    target.getByRole("dialog").first().getByRole("button", { name: label, exact: true });
  const choose = async (target, label, option) => {
    await field(target, label).click();
    const picker = target.getByRole("dialog").last();
    if (!option) {
      await picker.getByRole("button", { name: "Clear assignment" }).click();
      return;
    }
    const input = picker.getByRole("combobox");
    await input.fill(option);
    await expect(picker.getByRole("option")).toHaveCount(1);
    await input.press("Enter");
  };
  const polish = async (project) =>
    (
      await (
        await page.request.get(base + "/api/projects/" + project + "/capabilities/tools")
      ).json()
    ).voicePolish;
  await page.goto(base + "/models");
  await search(page, recognition);
  await expect(card(page, "River recognition")).toBeVisible();
  await open(page);
  await expect(page).toHaveURL(/projectSettings=multimodal/);
  await expect(field(page, "Image generation")).toBeDisabled();
  await expect(field(page, "Speech recognition")).toContainText("Not set");
  await field(page, "Speech recognition").click();
  const picker = page.getByRole("dialog").last();
  await expect(picker.getByRole("navigation", { name: "Model groups" })).toBeVisible();
  await picker.getByRole("combobox").fill("synthesis");
  await expect(picker.getByRole("option")).toHaveCount(0);
  await picker.getByRole("combobox").fill("recognition");
  await expect(picker.getByRole("option")).toHaveCount(2);
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/grouped-picker-en.png",
    });
  await picker.getByRole("combobox").press("Escape");
  await page.keyboard.press("Escape");
  const other = await context.newPage();
  await other.goto(page.url());
  await choose(page, "Speech recognition", "River recognition");
  await expect(field(other, "Speech recognition")).toContainText("River recognition");
  await choose(page, "Speech recognition", "Lake recognition");
  await expect(field(other, "Speech recognition")).toContainText("Lake recognition");
  await expect
    .poll(() => settings(a))
    .toEqual({ s2t: { provider: "deepseek", modelId: recognition } });
  expect(await settings(b)).toEqual({});
  await choose(page, "Speech synthesis", "River synthesis");
  await choose(page, "Text generation", "Project writer");
  await choose(page, "Image understanding", "Project writer");
  const originalPrompt = (await polish(a)).defaultPrompt;
  const prompt = page.getByRole("textbox", { name: "Polish instructions" });
  // Polishing shares the text generation model, which the switch's hint names.
  await expect(page.getByText("Polished by note-editor (custom)")).toBeVisible();
  await field(page, "Polish instructions").click();
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
  await expect(field(page, "Speech recognition")).toContainText("Lake recognition");
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/defaults-en.png",
    });
  await field(page, "Polish instructions").click();
  await expect(prompt).toHaveValue("Keep project names. Preserve all line breaks.");
  await field(page, "Restore default").click();
  await expect(prompt).toHaveValue(originalPrompt);
  await field(page, "Save").click();
  await expect.poll(() => polish(a)).toMatchObject({ enabled: true, prompt: originalPrompt });
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(field(page, "Image understanding")).toContainText("Project writer");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switchProject(page, "Cards Alpha", "Cards Beta");
  await page.getByRole("button", { name: "Cards Beta", exact: true }).click();
  await page.getByRole("button", { name: "Project settings", exact: true }).click();
  await expect(page).toHaveURL(/projectSettings=general/);
  await field(page, "Multimodal models").click();
  await expect(page).toHaveURL(/projectSettings=multimodal/);
  await page.reload();
  await expect(field(page, "Speech recognition")).toContainText("Not set");
  await choose(page, "Speech recognition", "River recognition");
  await expect
    .poll(() => settings(b))
    .toEqual({ s2t: { provider: "custom", modelId: recognition } });
  await choose(page, "Speech recognition", null);
  await expect.poll(() => settings(b)).toEqual({});
  await page.keyboard.press("Escape");
  await switchProject(page, "Cards Beta", "Cards Alpha");
  await setAccountPrefs(page.request, { lang: "zh" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await open(page);
  await expect(field(page, "语音识别")).toContainText("Lake recognition");
  const activeTab = page
    .getByRole("dialog")
    .getByRole("navigation")
    .getByRole("button", { name: "多模态模型", exact: true });
  await expect(activeTab).toBeFocused();
  const tabIsVisible = () =>
    activeTab.evaluate((button) => {
      const rail = button.closest("nav");
      const limits = rail.getBoundingClientRect();
      const tab = button.getBoundingClientRect();
      return (
        tab.left >= limits.left &&
        tab.right <= limits.right &&
        tab.left >= 0 &&
        tab.right <= window.innerWidth &&
        window.scrollX === 0 &&
        document.documentElement.scrollWidth <= window.innerWidth
      );
    });
  await expect.poll(tabIsVisible).toBe(true);
  await page.setViewportSize({ width: 320, height: 780 });
  await expect.poll(tabIsVisible).toBe(true);
  await field(page, "语音识别").click();
  const mobilePicker = page.getByRole("dialog").last();
  await mobilePicker.getByRole("combobox").fill(recognition);
  await expect(mobilePicker.getByRole("option")).toHaveCount(2);
  await expect(mobilePicker.getByRole("option").last()).toBeInViewport();
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/grouped-picker-zh-320.png",
    });
  await mobilePicker.getByRole("combobox").press("Escape");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(tabIsVisible).toBe(true);
  if (process.env.VOICE_EVIDENCE)
    await page.screenshot({
      animations: "disabled",
      path: process.env.VOICE_EVIDENCE + "/defaults-zh-phone.png",
    });
  await expect(page.getByRole("switch", { name: "润色语音输入" })).toBeChecked();
  await field(page, "润色提示词").click();
  const phonePrompt = "保留项目名称、数字和中英文术语，修正标点和口头重复。";
  await page.getByRole("textbox", { name: "润色提示词" }).fill(phonePrompt);
  await field(page, "保存").click();
  await expect.poll(() => polish(a)).toMatchObject({ enabled: true, prompt: phonePrompt });
  await expect(field(page, "保存")).toBeInViewport();
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
    await expect(field(memberPage, "Speech recognition")).toContainText("Lake recognition");
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
