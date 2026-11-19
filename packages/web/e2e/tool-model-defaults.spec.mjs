// A specialist's card assigns its Project tool. Replacing the model, including across
// providers with the same upstream id, leaves chat and the other tool bindings intact.
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const base = process.env.BASE_URL;
test("speech and image models can become tool defaults directly from their cards", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "tooldefaultcards", "password123");
  await setAccountPrefs(page.request, { lang: "zh" });
  const project = (await (await page.request.get(base + "/api/projects")).json()).projects[0]
    .projectId;
  const projectUrl = base + "/api/projects/" + project;
  const official = { provider: "deepseek", modelId: "deepseek-asr" };
  const proxy = { provider: "custom", modelId: "deepseek-asr" };
  const chat = { provider: "google", modelId: "gemini-4-carbon" };
  const image = { provider: "google", modelId: "gemini-3.1-flash-image" };
  const response = await page.request.put(projectUrl + "/models", {
    data: {
      models: [
        { ...official, displayName: "DeepSeek ASR" },
        { ...proxy, displayName: "Studio ASR", clientType: "deepseek-transcription" },
        { ...chat, displayName: "Carbon Chat" },
        { ...image, displayName: "Flash Image" },
      ],
      defaultModel: chat,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const card = (name) =>
    page
      .locator('[data-slot="card"]')
      .filter({ has: page.locator('[data-slot="name"]').filter({ hasText: name }) });
  await page.goto(base + "/models");
  const search = page.getByPlaceholder(/搜索模型|Search models/);
  await search.fill("asr");
  const choose = "设置为默认语音识别模型";
  await card("DeepSeek ASR").getByRole("button", { name: choose }).click();
  await expect(
    card("DeepSeek ASR").getByRole("button", { name: "当前默认语音识别模型" }),
  ).toBeDisabled();
  if (process.env.CARD_EVIDENCE)
    await page.screenshot({
      path: process.env.CARD_EVIDENCE + "/asr-defaults-zh.png",
      animations: "disabled",
    });
  await card("Studio ASR").getByRole("button", { name: choose }).click();
  await expect(card("DeepSeek ASR").getByRole("button", { name: choose })).toBeEnabled();
  await card("Studio ASR").getByText("Studio ASR", { exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "当前默认语音识别模型" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /^(设为|设置为)默认模型$/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await setAccountPrefs(page.request, { lang: "en" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await search.fill("Flash Image");
  await card("Flash Image")
    .getByRole("button", { name: "Set as default image generation model" })
    .click();
  await expect(
    card("Flash Image").getByRole("button", {
      name: "Default image generation model",
      exact: true,
    }),
  ).toBeDisabled();
  if (process.env.CARD_EVIDENCE)
    await page.screenshot({
      path: process.env.CARD_EVIDENCE + "/image-default-en-phone.png",
      animations: "disabled",
    });
  const toolConfig = await (await page.request.get(projectUrl + "/capabilities/tools")).json();
  expect(toolConfig.bindings).toMatchObject({ s2t: proxy, t2i: image });
  const modelConfig = await (await page.request.get(projectUrl + "/models")).json();
  expect(modelConfig.defaultModel).toEqual(chat);
});

// A saved specialist and a tools-first catalog must resolve to a chat-capable model for sending.
// With only tools left, the draft survives a trip to configure a chat model.
test("a draft restores a chat-capable model or takes the user to Models", async ({ page }) => {
  const user = "drafttoolmodel";
  await provisionAndLogin(page.request, user, "password123");
  await setAccountPrefs(page.request, { lang: "en", credentialGuideSeen: false });
  const project = (await (await page.request.get(base + "/api/projects")).json()).projects[0]
    .projectId;
  const modelUrl = base + "/api/projects/" + project + "/models";
  const specialist = { provider: "deepseek", modelId: "deepseek-asr" };
  const chat = { provider: "custom", modelId: "claude-4-8-mini" };
  const audio = { ...specialist, displayName: "Voice notes", clientType: "deepseek-transcription" };
  const general = {
    ...chat,
    displayName: "Photo chat",
    vision: true,
    contextWindow: 200000,
    apiKey: "test-key",
    baseUrl: process.env.MOCK_URL,
  };
  const setModels = async (models) => {
    const result = await page.request.put(modelUrl, { data: { models } });
    expect(result.ok(), await result.text()).toBe(true);
  };
  await setModels([audio, general]);
  const config = await (await page.request.get(modelUrl)).json();
  expect(config.defaultModel).toBeUndefined();
  expect(config.models[0]).toMatchObject({ ...specialist, chatEligible: false });
  const draftKey = "penguin.chatDraft." + user + "." + project;
  await page.addInitScript(
    ({ draftKey, specialist }) => {
      if (sessionStorage.getItem("seededDraft")) return;
      sessionStorage.setItem("seededDraft", "true");
      localStorage.setItem(
        draftKey,
        JSON.stringify({ text: "@plain use the conversation model", modelRef: specialist }),
      );
    },
    { draftKey, specialist },
  );
  await page.goto(base + "/chat/new");
  const picker = page.getByRole("button", { name: "Choose model", exact: true });
  await expect(picker).toContainText("Photo chat");
  await picker.click();
  const choices = page.getByRole("dialog", { name: "Choose model" });
  await choices.getByRole("combobox").fill("Voice notes");
  await expect(choices.getByRole("option")).toHaveCount(0);
  await choices.getByRole("combobox").fill("Photo chat");
  await choices.getByRole("combobox").press("Enter");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/);
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  const created = await (await page.request.get(base + "/api/sessions/" + sessionId)).json();
  expect(created.session).toMatchObject(chat);
  await expect(picker).toBeEnabled({ timeout: 35_000 });
  await picker.click();
  await choices.getByRole("combobox").fill("Voice notes");
  await expect(choices.getByRole("option")).toHaveCount(0);
  await setModels([audio]);
  await setAccountPrefs(page.request, { lang: "zh", credentialGuideSeen: false });
  await page.goto(base + "/chat/new");
  const noModels = page.getByText("请为这个项目添加一个支持对话的模型，然后发送消息。");
  await expect(noModels).toBeVisible();
  const draft = page.locator("textarea").first();
  await draft.fill("添加模型后继续");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  if (process.env.CARD_EVIDENCE)
    await page.screenshot({
      path: process.env.CARD_EVIDENCE + "/chat-model-required.png",
      animations: "disabled",
    });
  await page.getByRole("button", { name: "前往模型页", exact: true }).click();
  await expect(page).toHaveURL(/\/models$/);
  await setModels([audio, general]);
  await page.goBack();
  await expect(draft).toHaveValue("添加模型后继续");
  await expect(page.getByRole("button", { name: "选择模型", exact: true })).toContainText(
    "Photo chat",
  );
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});
