import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login, provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});
// Keep references to the real browser media objects so release and playback can be verified.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.voiceTracks = [];
    const getMedia = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = async function (...args) {
      const stream = await getMedia.apply(this, args);
      window.voiceTracks.push(...stream.getAudioTracks());
      return stream;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this instanceof HTMLAudioElement) window.voicePlayback = this;
      return play.apply(this, args);
    };
  });
});
async function expectPlaying(page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.voicePlayback &&
          !window.voicePlayback.paused &&
          window.voicePlayback.currentTime > 0,
        ),
      ),
    )
    .toBe(true);
}
async function expectReleased(page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.voicePlayback?.paused && !window.voicePlayback.hasAttribute("src")),
      ),
    )
    .toBe(true);
}
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
      const request = route.request().postDataJSON();
      expect(request).not.toHaveProperty("sessionId");
      const { audio } = request;
      expect(audio.mimeType).toMatch(/^audio\//);
      expect(Buffer.from(audio.data, "base64").length).toBeGreaterThan(100);
      captureCount++;
      await route.fulfill({ json: { status: "completed", text: raw, artifacts: [] } });
    });
    await page.route("**/voice-polish", async (route) => {
      const request = route.request().postDataJSON();
      expect(request.text).toBe(raw);
      expect(request).not.toHaveProperty("sessionId");
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
          model: speaker,
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
            "默认多模态模型",
            "语音识别",
            "语音输入",
            "结束录音并转写",
            "朗读回复",
            "停止朗读",
            "发送",
          ]
        : [
            "Default multimodal models",
            "Speech recognition",
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
      await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: label, exact: true })
        .click();
    };
    await select("deepseek-asr (deepseek)");
    await expect.poll(selected).toBe("deepseek");
    await select(lang === "zh" ? "未指定" : "Not assigned");
    await expect.poll(selected).toBeUndefined();
    await select("deepseek-asr (custom)");
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
    await expect
      .poll(() => page.evaluate(() => window.voiceTracks.map((track) => track.readyState)))
      .toEqual(["ended"]);
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
    expect(playbackCount).toBe(1);
    await page.goto(base + "/models");
    await expect(btn(0)).toBeVisible();
  });
}

test("speech uses the project's real MMSP routes and records each selected model's usage", async ({
  page,
}) => {
  const seen = [];
  let rejectSpeech = false;
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
    const synthesis = ["deepseek-tts", "fish-audio/drama-3"].includes(payload.model);
    if (synthesis && rejectSpeech) {
      res.writeHead(400).end();
      return;
    }
    const item = synthesis
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
    const tools = [
      ["image", "Image generation", "gpt-image-2.5-flare"],
      ["video", "Video generation", "gemini-omni-1.2-flash"],
      ["tts", "Speech synthesis", "deepseek-tts"],
      ["stt", "Speech recognition", "deepseek-asr"],
      ["search", "Web search", "deepseek-search"],
      ["fetch", "Fetch a web page", "deepseek-fetch"],
    ];
    const models = [...tools.map(([, , model]) => model), "deepseek-flash"].map((id) => ({
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
    for (const [capability, , model] of tools) {
      expect(capabilities.candidates[capability]).toEqual([ref(model)]);
    }
    expect(JSON.stringify(capabilities)).not.toContain("local-voice-test");
    const settings = await page.request.patch(api + "/capabilities", {
      data: {
        voicePolish: { enabled: true, model: ref("deepseek-flash") },
      },
    });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    await page.goto(base + "/models");
    await page.getByRole("button", { name: "Default multimodal models", exact: true }).click();
    for (const [, label, model] of tools) {
      await page.getByRole("button", { name: new RegExp("^" + label) }).click();
      await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: model + " (custom)", exact: true })
        .click();
    }
    const expectedBindings = Object.fromEntries(
      tools.map(([capability, , model]) => [capability, ref(model)]),
    );
    await expect
      .poll(async () => (await (await page.request.get(api + "/capabilities")).json()).bindings)
      .toEqual(expectedBindings);
    if (process.env.VOICE_EVIDENCE)
      await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/all-six-project-models.png" });
    await page.keyboard.press("Escape");
    const created = await page.request.post(api + "/agents/default_agent/sessions", {
      data: chat,
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { session } = await created.json();
    await page.goto(base + "/chat/" + session.sessionId);
    await page.getByRole("button", { name: "Dictate", exact: true }).click();
    const finish = page.getByRole("button", { name: "Finish recording and transcribe" });
    await expect(finish).toBeVisible();
    await page.waitForTimeout(450);
    await finish.click();
    const draft = page.locator("textarea").first();
    await expect(draft).toHaveValue("Meet at 3.");
    expect(seen[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "inline_data.done", mime_type: "audio/wav" }),
      ]),
    );
    expect(seen[1].items).toContainEqual({ type: "text.done", text: "meet meet at 3" });
    await draft.fill("@plain Meet at 3.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const read = page.getByRole("button", { name: "Read reply aloud", exact: true }).first();
    await expect(read).toBeVisible();
    await read.click();
    const stop = page.getByRole("button", { name: "Stop reading", exact: true });
    await expectPlaying(page);
    await stop.click();
    await expectReleased(page);
    const { runs } = await (await page.request.get(api + "/capabilities/usage")).json();
    for (const [capability, modelId] of [
      ["tts", "deepseek-tts"],
      ["stt", "deepseek-asr"],
      ["voice-polish", "deepseek-flash"],
    ]) {
      const run = runs.find((r) => r.capability === capability);
      expect(run).toMatchObject({
        model: ref(modelId),
        sessionId: session.sessionId,
        status: "completed",
      });
      expect(run.usage).toEqual({
        cached_tokens: 0,
        prompt_tokens: 10,
        thoughts_tokens: 0,
        response_tokens: 4,
      });
      expect(run.measurements).toContainEqual({ unit: "request", quantity: 1 });
      expect(Object.keys(run).some((key) => /cost|price|amount|currency|charge/i.test(key))).toBe(
        false,
      );
    }
    await read.click();
    await expectPlaying(page);
    await stop.click();
    await expectReleased(page);
    await page.reload();
    await read.click();
    await expectPlaying(page);
    await stop.click();
    const footer = read.locator("..");
    if (process.env.VOICE_EVIDENCE) {
      await read.hover();
      await footer.screenshot({ path: process.env.VOICE_EVIDENCE + "/reply-actions.png" });
    }
    const buttons = await footer
      .locator(":scope > button")
      .evaluateAll((items) =>
        items.map((item) => [item.offsetWidth, item.offsetHeight, item.getBoundingClientRect().y]),
      );
    expect(buttons).toHaveLength(3);
    expect(buttons[1]).toEqual(buttons[0]);
    expect(buttons[2]).toEqual(buttons[0]);
    await read.click();
    await expectPlaying(page);
    await page.locator('a[href="/models"]').first().click();
    await expectReleased(page);
    expect(seen.map((call) => call.model)).toEqual([
      "deepseek-asr",
      "deepseek-flash",
      "deepseek-tts",
    ]);
    for (const call of seen) {
      expect(call.path).toBe("/v1/stream");
      expect(call.config.session_id).toBe(session.sessionId);
    }

    // Switching models has to invalidate the old recording. A failed synthesis can be retried.
    const alternate = ref("fish-audio/drama-3");
    const chatRow = {
      ...chat,
      contextWindow: 200000,
      baseUrl: process.env.MOCK_URL,
      apiKey: "local-voice-test",
    };
    const voiceRows = [...models, { ...models[0], ...alternate }, chatRow];
    const useModel = await page.request.put(api + "/models", {
      data: { models: voiceRows, defaultModel: chat },
    });
    expect(useModel.ok()).toBe(true);
    expect(
      (
        await page.request.patch(api + "/capabilities", { data: { bindings: { tts: alternate } } })
      ).ok(),
    ).toBe(true);
    await page.goto(base + "/chat/" + session.sessionId);
    rejectSpeech = true;
    await read.click();
    await expect.poll(() => seen.filter((c) => c.model === alternate.modelId).length).toBe(1);
    await expect(read).toBeVisible();
    rejectSpeech = false;
    await read.click();
    await expectPlaying(page);
    await stop.click();
    await read.click();
    await expectPlaying(page);
    await stop.click();
    expect(seen.filter((c) => c.model === alternate.modelId)).toHaveLength(2);
    expect(
      (
        await page.request.patch(api + "/capabilities", {
          data: { bindings: { tts: ref("deepseek-tts") } },
        })
      ).ok(),
    ).toBe(true);
    await read.click();
    await expectPlaying(page);
    await stop.click();
    expect(seen.filter((c) => c.model === "deepseek-tts")).toHaveLength(1);

    const secondProject = "voiceintegrated-second";
    const other = base + "/api/projects/" + secondProject;
    const newProject = await page.request.post(base + "/api/projects", {
      data: { projectId: secondProject, name: "Another reading project" },
    });
    expect(newProject.status(), await newProject.text()).toBe(201);
    expect(
      (
        await page.request.put(other + "/models", {
          data: { models: voiceRows, defaultModel: chat },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.patch(other + "/capabilities", {
          data: { bindings: { tts: ref("deepseek-tts") } },
        })
      ).ok(),
    ).toBe(true);
    const otherSession = (
      await (
        await page.request.post(other + "/agents/default_agent/sessions", { data: chat })
      ).json()
    ).session.sessionId;
    const input = {
      sessionId: otherSession,
      text: seen.find((c) => c.model === "deepseek-tts").items[0].text,
      readAloud: true,
    };
    const invoke = async (text) =>
      (
        await (
          await page.request.post(other + "/capabilities/tts/run", { data: { ...input, text } })
        ).json()
      ).id;
    const [left, right] = await Promise.all([invoke(input.text), invoke(input.text)]);
    expect(left).toBeTruthy();
    expect(right).toBe(left);
    expect(await invoke(input.text + " Edited.")).not.toBe(left);
    expect(seen.filter((c) => c.model === "deepseek-tts")).toHaveLength(3);
    expect((await page.request.get(api + "/capabilities/runs/" + left)).status()).toBe(404);
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("disabling the project's provider stops dictation before upload and restores its saved models on enable", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const project = "voiceprovider",
    plugin = "@penguinharness/multimodal-tools";
  const api = base + "/api/projects/" + project,
    endpoint = api + "/plugins/installed";
  const created = await page.request.post(base + "/api/projects", {
    data: { projectId: project, name: "Voice provider test" },
  });
  expect([201, 409], await created.text()).toContain(created.status());
  const enabled = await page.request.post(endpoint, { data: { specifier: plugin } });
  expect(enabled.ok(), await enabled.text()).toBe(true);
  const models = [first, speaker].map((ref) => ({
    ...ref,
    clientType: "mmsp",
    contextWindow: 8000,
    apiKey: "local-test",
    baseUrl: process.env.MOCK_URL,
  }));
  const saved = await page.request.put(api + "/models", {
    data: {
      models: [
        ...models,
        { ...chat, contextWindow: 200000, apiKey: "sk-mock", baseUrl: process.env.MOCK_URL },
      ],
      defaultModel: chat,
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const bindings = { stt: first, tts: speaker };
  const selected = await page.request.patch(api + "/capabilities", { data: { bindings } });
  expect(selected.ok(), await selected.text()).toBe(true);
  const session = await page.request.post(api + "/agents/default_agent/sessions", { data: {} });
  expect(session.ok(), await session.text()).toBe(true);
  const { sessionId } = (await session.json()).session;
  await page.addInitScript((id) => localStorage.setItem("penguin.lastProjectId", id), project);
  const runs = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/(?:capabilities\/(?:stt|tts)\/run|voice-polish)$/.test(req.url())
    )
      runs.push(req.url());
  });
  await page.goto(base + "/chat/" + sessionId);
  const record = page.getByRole("button", { name: "Dictate", exact: true });
  await record.click();
  const finish = page.getByRole("button", { name: "Finish recording and transcribe", exact: true });
  await expect(finish).toBeVisible();
  try {
    const disabled = await page.request.delete(
      endpoint + "?specifier=" + encodeURIComponent(plugin),
    );
    expect(disabled.ok(), await disabled.text()).toBe(true);
    await expect
      .poll(async () => (await (await page.request.get(api + "/capabilities")).json()).available)
      .toEqual([]);
    if (await finish.isVisible()) await finish.click();
    await expect(record).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => window.voiceTracks.every((track) => track.readyState === "ended")),
      )
      .toBe(true);
    await expect(page.locator("textarea").first()).toBeEditable();
    await page.goto(base + "/models");
    await expect(page.getByPlaceholder("Search models")).toBeVisible();
    await page.getByRole("button", { name: "Default multimodal models", exact: true }).click();
    await expect(page.getByText("Multimodal tools are disabled on this server.")).toBeVisible();
    expect((await (await page.request.get(api + "/capabilities")).json()).bindings).toEqual(
      bindings,
    );
    expect(runs).toEqual([]);
    if (process.env.VOICE_EVIDENCE)
      await page.screenshot({ path: process.env.VOICE_EVIDENCE + "/provider-disabled-models.png" });
  } finally {
    const restored = await page.request.post(endpoint, { data: { specifier: plugin } });
    expect(restored.ok(), await restored.text()).toBe(true);
  }
  await page.reload();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Speech recognition", exact: true }),
  ).toContainText(first.modelId);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Speech synthesis", exact: true }),
  ).toContainText(speaker.modelId);
  await page.goto(base + "/chat/" + sessionId);
  await expect(record).toBeVisible();
});
