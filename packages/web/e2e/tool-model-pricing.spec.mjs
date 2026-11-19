import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const base = process.env.BASE_URL;
const models = [
  { provider: "deepseek", modelId: "deepseek-asr", displayName: "DeepSeek ASR" },
  {
    provider: "tokendance",
    modelId: "deepseek-asr",
    displayName: "DeepSeek ASR",
    clientType: "deepseek-transcription",
    baseUrl: "https://tokendance.space/gateway/deepseek",
  },
  { provider: "deepseek", modelId: "deepseek-tts", displayName: "DeepSeek TTS" },
  { provider: "google", modelId: "gemini-4-carbon", displayName: "Gemini 4 Carbon" },
];

for (const lang of ["zh", "en"]) {
  test(`model cards and the shared tool picker show provider-specific ASR rates in ${lang}`, async ({
    page,
  }) => {
    const user = "toolprices" + lang;
    await provisionAndLogin(page.request, user, "password123");
    await setAccountPrefs(page.request, { lang });
    const project = (await (await page.request.get(base + "/api/projects")).json()).projects[0]
      .projectId;
    const put = await page.request.put(base + "/api/projects/" + project + "/models", {
      data: { models, defaultModel: { provider: "google", modelId: "gemini-4-carbon" } },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    for (const provider of ["deepseek", "tokendance"]) {
      const key = await page.request.put(
        base + "/api/projects/" + project + "/models/providers/" + provider,
        { data: { apiKey: "local-browser-test" } },
      );
      expect(key.ok(), await key.text()).toBe(true);
    }
    await page.setViewportSize(
      lang === "zh" ? { width: 1365, height: 850 } : { width: 390, height: 844 },
    );
    await page.goto(base + "/models");
    // Both providers sell the same upstream id. The billing unit and currency must identify the offer.
    await page.getByPlaceholder(/搜索模型|Search models/).fill("deepseek-asr");
    const hour =
      lang === "zh"
        ? "限时 US$0.058/音频小时（原价 US$0.116）"
        : "Offer US$0.058/audio hour (list US$0.116)";
    const second =
      lang === "zh"
        ? "限时 ¥0.0001/音频秒（原价 ¥0.0002）"
        : "Offer ¥0.0001/audio second (list ¥0.0002)";
    const cardPrice = page.locator('[data-slot="card"] [data-slot="tool-price"]');
    await expect(cardPrice.filter({ hasText: hour })).toBeVisible();
    await expect(cardPrice.filter({ hasText: second })).toBeVisible();
    const snapshot = async (name) => {
      if (process.env.PRICE_EVIDENCE)
        await page.screenshot({
          path: process.env.PRICE_EVIDENCE + "/" + name + "-" + lang + ".png",
          animations: "disabled",
        });
    };
    if (lang === "en")
      await cardPrice
        .first()
        .evaluate((node) => node.closest('[data-slot="card"]').scrollIntoView({ block: "start" }));
    await snapshot("model-cards");
    await page
      .getByRole("button", { name: /^(Default multimodal models|默认多模态模型)$/ })
      .click();
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: /^(Speech recognition|语音识别)$/ })
      .click();
    const picker = page.getByRole("dialog").last();
    await picker.getByRole("combobox").fill("deepseek-asr");
    await expect(picker.getByRole("option").filter({ hasText: hour })).toBeVisible();
    await expect(picker.getByRole("option").filter({ hasText: second })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await snapshot("shared-picker");
    await page.goto(base + "/models");
    await page
      .getByRole("button", { name: /Add new models|同步新增模型/i })
      .first()
      .click();
    const preview = page.getByRole("dialog").last();
    await expect(
      preview.getByRole("listitem").filter({ hasText: "tokendance/seedream-5.0-lite" }),
    ).toContainText(lang === "zh" ? "¥0.22/张" : "¥0.22/image");
  });
}
