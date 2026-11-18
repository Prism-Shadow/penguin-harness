/**
 * Given a browser microphone, silence and sound reach the meter; cancelling keeps the draft,
 * releases the microphone, and never invokes transcription. Completing a fresh recording
 * requests one transcription and leaves the editable result in the composer. The toolbar
 * keeps the draft in place while permission, recording and transcription replace each other.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("microphone input drives the meter and the chosen action determines whether to transcribe", async ({
  page,
}) => {
  const base = process.env.BASE_URL;
  await provisionAndLogin(page.request, "voicemeter", "password123");
  await setAccountPrefs(page.request, { lang: "zh", themeMode: "dark" });
  const { projects } = await (await page.request.get(base + "/api/projects")).json();
  const api = base + "/api/projects/" + projects[0].projectId;
  const ref = { provider: "custom", modelId: "deepseek-asr" };
  const chat = { provider: "custom", modelId: "claude-4-8" };
  const model = await page.request.put(api + "/models", {
    data: {
      models: [
        {
          ...ref,
          clientType: "mmsp",
          contextWindow: 32000,
          apiKey: "local-test",
          baseUrl: process.env.MOCK_URL,
        },
        { ...chat, contextWindow: 200000, apiKey: "local-test", baseUrl: process.env.MOCK_URL },
      ],
      defaultModel: chat,
    },
  });
  expect(model.ok(), await model.text()).toBe(true);
  const assigned = await page.request.patch(api + "/capabilities", {
    data: { bindings: { stt: ref } },
  });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  await page.addInitScript(() => {
    window.capturedTracks = [];
    // A controllable microphone at the device boundary. A native MediaStream carries a
    // steady tone, so silence and resumed sound are repeatable on every browser machine.
    let audio, tone;
    const permission = new Promise((resolve) => {
      window.grantMicrophone = resolve;
    });
    navigator.mediaDevices.getUserMedia = async () => {
      await permission;
      if (!audio) {
        audio = new AudioContext();
        tone = audio.createOscillator();
        tone.start();
      }
      await audio.resume();
      const input = audio.createMediaStreamDestination();
      tone.connect(input);
      const stream = input.stream;
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      window.capturedTracks.push(track);
      return stream;
    };
  });
  let uploads = 0;
  const transcription = Promise.withResolvers();
  await page.route("**/capabilities/stt/run", async (route) => {
    await transcription.promise;
    uploads++;
    return route.fulfill({ json: { status: "completed", text: "下午开会", artifacts: [] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/chat/new");
  const draft = page.locator("textarea").first();
  const bounds = () =>
    draft.evaluate((area) => {
      const card = area.closest('[data-slot="composer"]').getBoundingClientRect();
      const text = area.getBoundingClientRect();
      return [card.y, card.height, text.y, text.height, card.bottom - text.bottom];
    });
  const record = page.getByRole("button", { name: "语音输入", exact: true });
  const done = page.getByRole("button", { name: "结束录音并转写" });
  const cancel = page.getByRole("button", { name: "取消语音输入" });
  const meter = page.getByRole("meter", { name: "麦克风音量" });
  await record.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const empty = await bounds();
  await record.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("等待麦克风授权", { exact: true })).toBeVisible();
  expect(await bounds()).toEqual(empty);
  await page.evaluate(() => window.grantMicrophone());
  await expect(done.getByText("完成", { exact: true })).toBeVisible();
  await expect(cancel).toHaveText("取消");
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  expect(await bounds()).toEqual(empty);
  const group = page.getByRole("group", { name: "语音输入" });
  expect((await group.boundingBox()).width).toBeLessThan((await draft.boundingBox()).width * 0.85);
  await page.evaluate(() => {
    window.capturedTracks[0].enabled = true;
  });
  await expect
    .poll(async () => Number(await meter.getAttribute("aria-valuenow")))
    .toBeGreaterThan(5);
  await cancel.click();
  await expect(record).toBeFocused();
  expect(await draft.inputValue()).toBe("");
  expect(await bounds()).toEqual(empty);
  expect(uploads).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.capturedTracks.map((t) => t.readyState)))
    .toEqual(["ended"]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const multiline = "周一安排\n上午见面\n记录如下";
  await draft.fill(multiline);
  const filled = await bounds();
  await record.click();
  await expect(meter).toBeVisible();
  await expect(meter).toContainText("安静");
  expect(await bounds()).toEqual(filled);
  await page.evaluate(() => {
    window.capturedTracks.at(-1).enabled = true;
  });
  await expect(meter).toContainText("收到声音");
  await done.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("正在转写", { exact: true })).toBeVisible();
  expect(await bounds()).toEqual(filled);
  transcription.resolve();
  await expect(draft).toHaveValue(multiline + "下午开会");
  expect(await bounds()).toEqual(filled);
  expect(uploads).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.capturedTracks.map((t) => t.readyState)))
    .toEqual(["ended", "ended"]);
  await expect(page).toHaveURL(/\/chat\/new$/);
});
