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
