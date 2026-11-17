import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});
const base = process.env.BASE_URL;
const first = { provider: "custom", modelId: "deepseek-asr" };
const second = { provider: "deepseek", modelId: "deepseek-asr" };
const speaker = { provider: "custom", modelId: "deepseek-tts" };
const chat = { provider: "custom", modelId: "claude-4-8" };

for (const lang of ["zh", "en"]) {
  test(`${lang}: assign, dictate, edit and read an assistant reply`, async ({ page }) => {
    await provisionAndLogin(page.request, "voice" + lang, "password123");
    await setAccountPrefs(page.request, { lang });
    const { projects } = await (await page.request.get(base + "/api/projects")).json();
    const project = projects[0].projectId;
    const saved = await page.request.put(`${base}/api/projects/${project}/models`, {
      data: {
        defaultModel: chat,
        models: [
          ...[first, second, speaker].map((ref) => ({
            ...ref,
            clientType: "mmsp",
            contextWindow: 32000,
            apiKey: "local-test",
            baseUrl: process.env.MOCK_URL,
          })),
          { ...chat, contextWindow: 200000, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL },
        ],
      },
    });
    expect(saved.ok()).toBeTruthy();
    const configUrl = base + "/api/projects/" + project + "/capabilities";
    const assigned = await page.request.patch(configUrl, {
      data: { bindings: { tts: speaker }, voicePolish: { enabled: true, model: chat } },
    });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const selected = async () =>
      (await (await page.request.get(configUrl)).json()).bindings.stt?.provider;
    const raw = lang === "zh" ? "周五三点在西湖" : "Meet at West Lake at 3";
    let polishWorks = false,
      captureCount = 0,
      playbackCount = 0;
    await page.route("**/capabilities/stt/run", async (route) => {
      const { audio } = route.request().postDataJSON();
      expect(audio.mimeType).toMatch(/^audio\//);
      expect(Buffer.from(audio.data, "base64").length).toBeGreaterThan(100);
      captureCount++;
      await route.fulfill({ json: { status: "completed", text: raw, artifacts: [] } });
    });
    await page.route("**/voice-polish", async (route) => {
      expect(route.request().postDataJSON().text).toBe(raw);
      await route.fulfill(
        polishWorks
          ? { json: { text: raw + "!" } }
          : { status: 503, json: { error: "provider unavailable" } },
      );
    });
    // A real, eight-second mono PCM WAV leaves time to press Stop while it is playing.
    const wav = Buffer.alloc(44 + 8000 * 2 * 8);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await page.route("**/capabilities/tts/run", async (route) => {
      expect(route.request().postDataJSON().text.trim()).toBeTruthy();
      playbackCount++;
      await route.fulfill({
        json: {
          status: "completed",
          artifacts: [{ mimeType: "audio/wav", url: "/api/voice-fixture.wav" }],
        },
      });
    });
    await page.route("**/api/voice-fixture.wav", (route) =>
      route.fulfill({ body: wav, contentType: "audio/wav" }),
    );
    const labels =
      lang === "zh"
        ? [
            "CLI 与语音模型",
            "语音转写",
            "语音输入",
            "结束录音并转写",
            "朗读回复",
            "停止朗读",
            "发送",
          ]
        : [
            "CLI and voice models",
            "Speech transcription",
            "Dictate",
            "Finish recording and transcribe",
            "Read reply aloud",
            "Stop reading",
            "Send",
          ];
    const btn = (i) => page.getByRole("button", { name: labels[i], exact: true }).first();
    await page.goto(base + "/models");
    await btn(0).click();
    const field = page.getByRole("button", { name: new RegExp("^" + labels[1]) });
    const select = async (label) => {
      await field.click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    await select("deepseek-asr · deepseek");
    await expect.poll(selected).toBe("deepseek");
    await select(lang === "zh" ? "未指定" : "Not assigned");
    await expect.poll(selected).toBeUndefined();
    await select("deepseek-asr · custom");
    await expect.poll(selected).toBe("custom");
    if (process.env.VOICE_EVIDENCE)
      await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/" + lang + "-models.png" });
    await page.keyboard.press("Escape");
    if (lang === "zh") await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/chat/new");
    const draft = page.locator("textarea").first();
    await draft.fill("Before");
    await btn(2).focus();
    await page.keyboard.press("Enter");
    await expect(btn(3)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(btn(2)).toBeVisible();
    expect(captureCount).toBe(0);
    await btn(2).click();
    await expect(btn(3)).toBeVisible();
    await page.waitForTimeout(420);
    if (process.env.VOICE_EVIDENCE)
      await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/" + lang + "-recording.png" });
    await btn(3).click();
    await expect(draft).toHaveValue(new RegExp(raw));
    expect(await draft.inputValue()).toContain("Before");
    await expect(page).toHaveURL(/\/chat\/new/);
    polishWorks = true;
    await draft.fill("");
    await btn(2).click();
    await expect(btn(3)).toBeVisible();
    await page.waitForTimeout(400);
    await btn(3).click();
    await expect(draft).toHaveValue(raw + "!");
    await draft.fill("@plain " + raw + " edited");
    await btn(6).click();
    await expect(btn(4)).toBeVisible({ timeout: 35000 });
    await btn(4).click();
    await expect(btn(5)).toHaveAttribute("aria-pressed", "true");
    await btn(5).click();
    await expect(btn(4)).toBeVisible();
    expect(playbackCount).toBe(1);
    await btn(4).click();
    await expect(btn(5)).toBeVisible();
    await page.goto(base + "/models");
    await expect(btn(0)).toBeVisible();
  });
}

test("speech uses the project's real MMSP routes and records each selected model's usage", async ({
  page,
}) => {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    seen.push({
      path: req.url,
      model: payload.model,
      items: payload.messages.flatMap((m) => m.content_items),
      config: payload.config,
    });
    const item =
      payload.model === "deepseek-tts"
        ? {
            type: "inline_data.done",
            mime_type: "audio/pcm;rate=8000",
            data: Buffer.alloc(8000 * 2 * 5).toString("base64"),
          }
        : {
            type: "text.done",
            text: payload.model === "deepseek-asr" ? "meet meet at 3" : "Meet at 3.",
          };
    const event = {
      role: "assistant",
      event_type: "delta",
      content_items: [item],
      usage_metadata: null,
      finish_reason: null,
    };
    const stop = {
      role: "assistant",
      event_type: "stop",
      content_items: [],
      usage_metadata: {
        cached_tokens: 0,
        prompt_tokens: 10,
        thoughts_tokens: 0,
        response_tokens: 4,
      },
      finish_reason: "stop",
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      [event, stop].map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    await provisionAndLogin(page.request, "voiceintegrated", "password123");
    await setAccountPrefs(page.request, { lang: "en" });
    const { projects } = await (await page.request.get(base + "/api/projects")).json();
    const project = projects[0].projectId;
    const api = base + "/api/projects/" + project;
    const ref = (modelId) => ({ provider: "custom", modelId });
    const models = ["deepseek-tts", "deepseek-asr", "deepseek-flash"].map((id) => ({
      ...ref(id),
      baseUrl: "http://127.0.0.1:" + upstream.address().port + "/v1",
      clientType: "mmsp",
      apiKey: "local-voice-test",
      contextWindow: 32000,
    }));
    const result = await page.request.put(api + "/models", {
      data: {
        models: [
          ...models,
          {
            ...chat,
            contextWindow: 200000,
            baseUrl: process.env.MOCK_URL,
            apiKey: "local-voice-test",
          },
        ],
        defaultModel: chat,
      },
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    const capabilities = await (await page.request.get(api + "/capabilities")).json();
    expect(capabilities.candidates.stt).toContainEqual(ref("deepseek-asr"));
    expect(capabilities.candidates.tts).toContainEqual(ref("deepseek-tts"));
    expect(JSON.stringify(capabilities)).not.toContain("local-voice-test");
    const settings = await page.request.patch(api + "/capabilities", {
      data: {
        bindings: { tts: ref("deepseek-tts") },
        voicePolish: { enabled: true, model: ref("deepseek-flash") },
      },
    });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    await page.goto(base + "/models");
    await page.getByRole("button", { name: "CLI and voice models", exact: true }).click();
    await page.getByRole("button", { name: /^Speech transcription/ }).click();
    await page.getByRole("option", { name: "deepseek-asr · custom", exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get(api + "/capabilities")).json()).bindings.stt)
      .toEqual(ref("deepseek-asr"));
    await page.keyboard.press("Escape");
    await page.goto(base + "/chat/new");
    await page.getByRole("button", { name: "Dictate", exact: true }).click();
    const finish = page.getByRole("button", { name: "Finish recording and transcribe" });
    await expect(finish).toBeVisible();
    await page.waitForTimeout(450);
    await finish.click();
    const draft = page.locator("textarea").first();
    await expect(draft).toHaveValue("Meet at 3.");
    expect(seen[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "inline_data.done", mime_type: "audio/webm" }),
      ]),
    );
    expect(seen[1].items).toContainEqual({ type: "text.done", text: "meet meet at 3" });
    await draft.fill("@plain Meet at 3.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const read = page.getByRole("button", { name: "Read reply aloud", exact: true }).first();
    await expect(read).toBeVisible();
    await read.click();
    const stop = page.getByRole("button", { name: "Stop reading", exact: true });
    await expect(stop).toHaveAttribute("aria-pressed", "true");
    await stop.click();
    const { runs } = await (await page.request.get(api + "/capabilities/usage")).json();
    for (const [capability, modelId] of [
      ["tts", "deepseek-tts"],
      ["stt", "deepseek-asr"],
      ["voice-polish", "deepseek-flash"],
    ]) {
      expect(runs).toContainEqual(
        expect.objectContaining({
          capability,
          model: ref(modelId),
          status: "completed",
          usage: expect.objectContaining({ prompt_tokens: 10, response_tokens: 4 }),
        }),
      );
    }
    expect(seen.map((call) => call.path)).toEqual(["/v1/stream", "/v1/stream", "/v1/stream"]);
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
