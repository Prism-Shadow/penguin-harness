/**
 * A reply's link to an audio file in the Workspace, end to end: nothing here is intercepted.
 *
 * run.sh enables plugins/example-music for default_project before the server starts, so the
 * server answers GET /api/contributions with its rule (`mp3`/`wav`/`ogg`/`m4a` → the app's builtin
 * `audio`). The mock model answers "music link test" with a reply whose first paragraph links
 * music/evening.wav twice and shows a look-alike link inside a code span, and whose second paragraph
 * links chime.ogg, which does not exist.
 *
 * - One player sits directly below each linking paragraph, one per file; the code span gets none.
 * - The links stay links: same href, no new tab.
 * - The player's src is the Workspace file URL, answering 200 with an audio content type, and the
 *   browser decodes the file; the missing file's player turns into a line saying so.
 * - With `?safe` the reply renders without a player.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const U = `music_${Date.now().toString(36)}`;
const P = "password123";

/** A short mono 16-bit WAV: a quarter second of A4. */
function wav() {
  const rate = 8000;
  const n = rate / 4;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return buf;
}

test("music: a reply's link to an audio file gets a player below its paragraph", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
          pricing: { cacheRead: 1, cacheWrite: 5, output: 10 },
        },
      ],
    },
  });
  expect(put.ok(), "put models").toBeTruthy();
  const created = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/default_agent/sessions`,
    { data: {} },
  );
  const sessionId = (await created.json()).session.sessionId;
  const up = await page.request.put(
    `${BASE}/api/sessions/${sessionId}/files/content?path=music%2Fevening.wav`,
    { data: { dataBase64: wav().toString("base64") } },
  );
  expect(up.ok(), "upload wav").toBeTruthy();

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("music link test");
  await page.getByRole("button", { name: "发送" }).click();

  const first = page.locator("p", { hasText: "Here is your tune" });
  await expect(first).toBeVisible();
  // The player is the paragraph's next sibling, holding one player for the file linked twice.
  const below = first.locator("xpath=following-sibling::*[1]");
  await expect(below).toHaveAttribute("data-reply-files", "");
  await expect(below.locator("audio")).toHaveCount(1);
  const player = below.getByLabel("播放 evening.wav");
  await expect(player).toHaveAttribute("controls", "");
  await expect(player).toHaveAttribute("preload", "none");

  // The links are untouched: still links to the file, opening nothing in a new tab.
  const link = first.getByRole("link", { name: "Evening Theme" });
  await expect(link).toHaveAttribute("href", "music/evening.wav");
  await expect(link).not.toHaveAttribute("target", "_blank");
  // Text in a code span is not a link.
  await expect(first.locator("code")).toHaveText("[code](music/code.wav)");
  await expect(page.getByLabel("播放 code.wav")).toHaveCount(0);

  // The second paragraph has its own player; two in the whole reply.
  const second = page.locator("p", { hasText: "And a chime" });
  await expect(second.locator("xpath=following-sibling::*[1]").locator("audio")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveCount(2);

  // The src is the Workspace file URL: 200, an audio type, and a file the browser decodes.
  const src = await player.getAttribute("src");
  expect(src).toBe(`/api/sessions/${sessionId}/files/content?path=music%2Fevening.wav`);
  const res = await page.request.get(`${BASE}${src}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("audio/wav");
  const duration = await player.evaluate(
    (el) =>
      new Promise((resolve, reject) => {
        el.addEventListener("loadedmetadata", () => resolve(el.duration), { once: true });
        el.addEventListener("error", () => reject(new Error("audio error")), { once: true });
        el.load();
      }),
  );
  expect(duration).toBeCloseTo(0.25, 1);

  // A missing file: once loading fails, the player says so instead.
  await page.getByLabel("播放 chime.ogg").evaluate((el) => el.load());
  await expect(page.getByRole("status").filter({ hasText: "无法播放 chime.ogg" })).toBeVisible();

  // Safe mode: the same reply, no player.
  await page.goto(`${BASE}/chat/${sessionId}?safe`);
  await expect(page.locator("p", { hasText: "Here is your tune" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Evening Theme" })).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
});
