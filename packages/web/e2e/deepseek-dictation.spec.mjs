/**
 * A cancelled recording stays local. Completed browser dictations send one real multipart
 * PCM WAV each. One upstream refusal leaves the draft intact and adds exactly one error.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test("DeepSeek dictation sends each completed microphone recording once as PCM WAV", async ({
  page,
}) => {
  const uploads = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers["content-type"] },
    }).formData();
    const file = form.get("file");
    uploads.push({
      path: req.url,
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    const retry = uploads.length === 2;
    res.writeHead(retry ? 200 : 400, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        retry ? { text: "Received speech" } : { error: { message: "Test transcription failure" } },
      ),
    );
  }).listen(0, "127.0.0.1");
  try {
    await once(upstream, "listening");
    const local = "http://127.0.0.1:" + upstream.address().port;
    const base = process.env.BASE_URL;
    await provisionAndLogin(page.request, "deepseekdictation", "password123");
    await setAccountPrefs(page.request, { lang: "en" });
    const { projects } = await (await page.request.get(base + "/api/projects")).json();
    const api = base + "/api/projects/" + projects[0].projectId;
    const direct = { provider: "deepseek", modelId: "deepseek-asr" };
    const gateway = { provider: "tokendance", modelId: "deepseek-asr" };
    const chat = { provider: "custom", modelId: "claude-4-8" };
    const saved = await page.request.put(api + "/models", {
      data: {
        models: [
          {
            ...direct,
            clientType: "deepseek-official",
            contextWindow: 32000,
            apiKey: "local-test",
            baseUrl: local + "/official",
          },
          {
            ...gateway,
            clientType: "deepseek-transcription",
            contextWindow: 32000,
            apiKey: "local-test",
            baseUrl: local + "/gateway/deepseek",
          },
          { ...chat, contextWindow: 32000, apiKey: "local-test", baseUrl: process.env.MOCK_URL },
        ],
        defaultModel: chat,
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const bind = async (model) => {
      const reply = await page.request.patch(api + "/capabilities", {
        data: { bindings: { stt: model } },
      });
      expect(reply.ok(), await reply.text()).toBe(true);
      expect(await reply.json()).toMatchObject({ dictationFormat: "audio/wav" });
    };
    await bind(direct);
    await page.goto(base + "/chat/new");
    const draft = page.locator("textarea").first();
    await draft.fill("Existing");
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url() === api + "/capabilities/stt/run") posts++;
    });
    const record = page.getByRole("button", { name: "Dictate", exact: true });
    const finish = page.getByRole("button", { name: "Finish recording", exact: true });
    await record.click();
    await expect(finish).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(record).toBeVisible();
    expect(posts).toBe(0);
    expect(uploads).toHaveLength(0);
    const complete = async () => {
      await record.click();
      await expect(finish).toBeVisible();
      // The fixture microphone needs time to deliver actual frames to MediaRecorder.
      await page.waitForTimeout(350);
      await finish.click();
    };
    await complete();
    await expect(record).toBeVisible();
    expect(posts).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(await draft.inputValue()).toBe("Existing");
    const { items } = await (await page.request.get(api + "/usage/errors")).json();
    expect(items.filter((i) => i.code === "capability_failed")).toMatchObject([{ count: 1 }]);
    await bind(gateway);
    await complete();
    await expect(draft).toHaveValue(/Received speech/);
    expect(posts).toBe(2);
    expect(uploads.map((u) => u.path)).toEqual([
      "/official/v1/tools/asr",
      "/gateway/deepseek/v1/tools/asr",
    ]);
    for (const { type, name, bytes } of uploads) {
      expect(type).toBe("audio/wav");
      expect(name).toMatch(/\.wav$/);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 16)).toBe("WAVEfmt ");
      expect(bytes.readUInt16LE(20)).toBe(1);
      expect(bytes.readUInt16LE(22)).toBe(1);
      expect(bytes.readUInt32LE(24)).toBe(16000);
      expect(bytes.readUInt16LE(34)).toBe(16);
      expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
      expect(bytes.length).toBeGreaterThan(1024);
    }
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
