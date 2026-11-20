/**
 * The Web App over the multimodal tools plugin (manual: not in CI's list; run with run.sh).
 *
 * - A tool model's dialog binds it to an operation through the platform's bindings; its card
 *   then marks it, and Project settings shows it in that operation's picker.
 * - Dictation records 16 kHz PCM WAV, sends it to the plugin's speech recognition, and lands the
 *   text in the composer while Send keeps its place.
 * - Reading a reply aloud plays the audio the plugin answers with, and stops on a second press.
 *
 * Nothing reaches a model provider: the chat model is the mock LLM, and the plugin's speech
 * routes are answered here.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const CHAT = { provider: "custom", modelId: "claude-4-8" };
const ASR = { provider: "deepseek", modelId: "deepseek-asr" };
const TTS = { provider: "deepseek", modelId: "deepseek-tts" };

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

/** A second of a quiet tone as 16 kHz PCM WAV: what the read-aloud route answers with here. */
function toneWav() {
  const rate = 16000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * The admin's Project (only an admin turns a server plugin on) with the multimodal tools plugin
 * on, its table plus the mock chat model, and DeepSeek's speech models keyed.
 */
async function seed(page) {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get(`${BASE}/api/projects`)).json();
  const project = projects[0].projectId;
  const api = `${BASE}/api/projects/${project}`;
  const installed = await page.request.post(`${api}/plugins/installed`, {
    data: { specifier: "@penguinharness/multimodal-tools" },
  });
  expect(installed.ok(), await installed.text()).toBeTruthy();
  const current = await (await page.request.get(`${api}/models`)).json();
  const rows = current.models.map((m) => {
    const entry = { provider: m.provider, modelId: m.modelId };
    for (const key of ["displayName", "contextWindow", "clientType", "vision", "pricing"])
      if (m[key] !== undefined) entry[key] = m[key];
    if (m.provider === "deepseek") entry.apiKey = "sk-local-test";
    return entry;
  });
  for (const ref of [ASR, TTS])
    if (!rows.some((r) => r.provider === ref.provider && r.modelId === ref.modelId))
      rows.push({ ...ref, apiKey: "sk-local-test" });
  // An earlier test of the run may have added it already: the table holds one row per pair.
  const chat = rows.findIndex((r) => r.provider === CHAT.provider && r.modelId === CHAT.modelId);
  const chatRow = { ...CHAT, apiKey: "sk-mock", baseUrl: MOCK, contextWindow: 200000 };
  if (chat === -1) rows.push(chatRow);
  else rows[chat] = chatRow;
  const put = await page.request.put(`${api}/models`, {
    data: { defaultModel: CHAT, models: rows },
  });
  expect(put.ok(), await put.text()).toBeTruthy();
  const { bindings } = await (await page.request.get(`${api}/models/tool-bindings`)).json();
  expect(bindings.map((b) => b.key)).toEqual(expect.arrayContaining(["s2t", "t2s", "t2t"]));
  return { project, api };
}

async function bind(page, api, key, model) {
  const res = await page.request.patch(`${api}/models/tool-bindings`, { data: { key, model } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test("a tool model's dialog binds it; its card marks it and Project settings shows it", async ({
  page,
}) => {
  const { api } = await seed(page);
  await bind(page, api, "s2t", null);
  await page.goto(`${BASE}/models`);
  await page.getByPlaceholder(/Search models/).fill("DeepSeek ASR");
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="name"]').filter({ hasText: "DeepSeek ASR" }) })
    .last();
  await expect(card.locator('[data-slot="in-use"]')).toHaveCount(0);
  await card.locator('[data-slot="name"]').click();
  const dialog = page.getByRole("dialog").last();
  const row = dialog.locator('[data-operation="s2t"]');
  await row.getByRole("button", { name: "Set default" }).click();
  await expect(row.getByText("In use")).toBeVisible();
  const { bindings } = await (await page.request.get(`${api}/models/tool-bindings`)).json();
  expect(bindings.find((b) => b.key === "s2t").model).toEqual(ASR);
  await page.keyboard.press("Escape");
  await expect(card.locator('[data-slot="in-use"]')).toHaveAttribute(
    "aria-label",
    "In use: Speech recognition",
  );

  await page.goto(`${BASE}/models?projectSettings=multimodal`);
  const settings = page.getByRole("dialog");
  await expect(settings.getByText("Image understanding")).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Speech recognition/ })).toContainText(
    "DeepSeek ASR",
  );
});

test("dictation sends 16 kHz WAV to speech recognition and Send keeps its place", async ({
  page,
}) => {
  const { api } = await seed(page);
  await bind(page, api, "s2t", ASR);
  const uploads = [];
  await page.route("**/multimodal-tools/s2t/run", async (route) => {
    const body = route.request().postDataJSON();
    uploads.push(body.audio);
    await route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000001",
        operation: "s2t",
        model: ASR,
        createdAt: new Date().toISOString(),
        status: "completed",
        text: "Summarize the meeting",
        files: [],
      },
    });
  });
  await page.goto(`${BASE}/chat/new`);
  const mic = page.getByRole("button", { name: "Dictate", exact: true });
  await mic.waitFor();
  const send = page.getByRole("button", { name: "Send", exact: true });
  const before = await send.boundingBox();
  await mic.click();
  await page.getByRole("meter").first().waitFor();
  expect(await send.boundingBox()).toEqual(before);
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Finish recording" }).click();
  await expect(page.locator("textarea").first()).toHaveValue("Summarize the meeting");
  expect(uploads).toHaveLength(1);
  expect(uploads[0].mimeType).toBe("audio/wav");
  expect(Buffer.from(uploads[0].data, "base64").toString("ascii", 8, 12)).toBe("WAVE");
});

test("a reply plays the audio the plugin answers with, and stops on a second press", async ({
  page,
}) => {
  const { project, api } = await seed(page);
  await bind(page, api, "t2s", TTS);
  const created = await page.request.post(`${api}/agents/default_agent/sessions`, {
    data: CHAT,
  });
  const sessionId = (await created.json()).session.sessionId;
  const audioPath = `/api/projects/${project}/multimodal-tools/sessions/${sessionId}/read-aloud/${"a".repeat(32)}.wav`;
  const reads = [];
  await page.route("**/multimodal-tools/read-aloud", async (route) => {
    reads.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        name: `${"a".repeat(32)}.wav`,
        mimeType: "audio/wav",
        bytes: 32044,
        url: audioPath,
        model: TTS,
      },
    });
  });
  await page.route(`**${audioPath}`, (route) =>
    route.fulfill({ body: toneWav(), contentType: "audio/wav" }),
  );
  await page.goto(`${BASE}/chat/${sessionId}`);
  const box = page.locator("textarea").first();
  await box.fill("Read this back");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = page.getByText("Command finished; the result looks as expected.").first();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await reply.hover();
  await page.getByRole("button", { name: "Read aloud" }).first().click();
  const stop = page.getByRole("button", { name: "Stop reading" }).first();
  await expect(stop).toBeVisible();
  // The control reads "Stop reading" from the press on; the request follows the binding's re-read.
  await expect.poll(() => reads.length).toBe(1);
  expect(reads).toEqual([{ sessionId, text: expect.stringContaining("Command finished") }]);
  await stop.click();
  await expect(page.getByRole("button", { name: "Read aloud" }).first()).toBeVisible();
});
