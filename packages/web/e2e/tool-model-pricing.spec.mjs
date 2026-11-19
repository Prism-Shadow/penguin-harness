import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const base = process.env.BASE_URL;
const models = [
  { provider: "jina", modelId: "jina-search", displayName: "Jina Search" },
  { provider: "jina", modelId: "jina-fetch", displayName: "Jina Reader" },
  {
    provider: "custom",
    modelId: "jina-search",
    displayName: "Private Search",
    clientType: "jina-webtool",
    baseUrl: "https://proxy.example",
    apiKey: "local-browser-test",
  },
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
  test(`model cards and the shared tool picker show native ASR tariffs and route-specific Jina estimates in ${lang}`, async ({
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
    for (const provider of ["deepseek", "tokendance", "jina"]) {
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
    const lookup = page.getByPlaceholder(/搜索模型|Search models/);
    await lookup.fill("jina");
    const reference =
      lang === "zh"
        ? "MMSP 参考价 US$0.05/百万输入 Token"
        : "MMSP reference · US$0.05/1M input tokens";
    const missing = lang === "zh" ? "价格以供应商为准" : "See provider pricing";
    const card = (label) =>
      page
        .locator('[data-slot="card"]')
        .filter({ has: page.locator('[data-slot="name"]').filter({ hasText: label }) });
    await expect(card("Jina Search")).toContainText(reference);
    await expect(card("Jina Reader")).toContainText(reference);
    await expect(card("Private Search")).toContainText(missing);
    await card("Jina Search").getByText("Jina Search", { exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByRole("button", { name: /^(详细配置|Details)$/ }).click();
    await expect(
      dialog.getByRole("link", { name: /查看供应商套餐|View provider plans/ }),
    ).toHaveAttribute("href", "https://jina.ai/api-dashboard/pricing/");
    await page.goto(base + "/models");
    await lookup.fill("jina");
    await card("Jina Search").scrollIntoViewIfNeeded();
    await snapshot("jina-model-cards");
    await page
      .getByRole("button", { name: /^(Default multimodal models|默认多模态模型)$/ })
      .click();
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: /^(Web search|网页搜索)$/ })
      .click();
    const webTool = page.getByRole("dialog").last();
    await webTool.getByRole("combobox").fill("jina-search");
    await expect(webTool.getByRole("option").filter({ hasText: "Jina Search" })).toContainText(
      reference,
    );
    await expect(webTool.getByRole("option").filter({ hasText: "Private Search" })).toContainText(
      missing,
    );
    await snapshot("jina-shared-picker");
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
