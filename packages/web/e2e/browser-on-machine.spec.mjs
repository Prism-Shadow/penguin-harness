/**
 * The Browser panel of a conversation whose Workspace lives on a machine: it shows the Chrome
 * that machine runs, which is the one the conversation's agent drives.
 *
 * A hub and one connected machine (machine.mjs), and a page served on the machine's loopback,
 * which only a browser on that machine can open:
 *
 * - The Session is created on the machine, and its panel is the machine's: ready, with no tab,
 *   while the hub's own browser stays the user's Chrome waiting to be paired.
 * - The agent runs `penguin browser open <the loopback page>` in the Session's shell. The tab
 *   appears in the panel's strip, and the page's picture arrives through the hub's proxy: the
 *   left half is the page's red, read back from the canvas.
 * - A click in the panel, on the page's button in the right half, reaches the page: the picture
 *   turns green.
 * - The agent runs `penguin browser scan`, and reads the page as the click left it.
 *
 * Skipped where the box has no Chrome for the machine to run (`PENGUIN_TEST_CHROME` names one;
 * otherwise the usual install locations are tried).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { startHubWithMachine } from "./machine.mjs";

const MOCK = process.env.MOCK_URL;
const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8940);
const MACHINE_PORT = Number(process.env.E2E_MACHINE_PORT ?? 8941);
/** Where to leave a picture of the panel showing the page; none without it. */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

const MODEL = {
  defaultModel: { provider: "custom", modelId: "claude-4-8" },
  models: [
    {
      provider: "custom",
      modelId: "claude-4-8",
      apiKey: "sk-mock",
      baseUrl: MOCK,
      contextWindow: 200000,
    },
  ],
};

function findChrome() {
  const named = process.env.PENGUIN_TEST_CHROME;
  if (named) return fs.existsSync(named) ? named : null;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];
  const onPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .flatMap((dir) => names.map((name) => path.join(dir, name)));
  const known = ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  return [...onPath, ...known].find((file) => fs.existsSync(file)) ?? null;
}

/** Red, with a button over its right half that turns everything green and says so. */
const PAGE = `<!doctype html>
<html>
  <head><title>Machine page</title></head>
  <body style="margin:0;background:#cc0000">
    <button
      id="go"
      style="position:fixed;left:50%;top:0;width:50%;height:100%;border:0;background:#cc0000;color:#fff;font-size:32px"
      onclick="document.body.style.background=this.style.background='#008800';this.textContent='pressed by a person';document.title='Pressed'"
    >press me</button>
  </body>
</html>`;

function servePage() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }),
    ),
  );
}

/** The colour of the picture at a point given as fractions of its size. */
const pixelAt = (picture, fx, fy) =>
  picture.evaluate(
    (canvas, [x, y]) => {
      if (canvas.width === 0 || canvas.height === 0) return null;
      const at = [Math.floor(canvas.width * x), Math.floor(canvas.height * y)];
      const [r, g, b] = canvas.getContext("2d").getImageData(at[0], at[1], 1, 1).data;
      return { r, g, b };
    },
    [fx, fy],
  );
const isRed = (c) => c !== null && c.r > 150 && c.g < 80 && c.b < 80;
const isGreen = (c) => c !== null && c.g > 90 && c.r < 80 && c.b < 80;

const chrome = findChrome();
let harness;
let site;

test.beforeAll(async () => {
  if (chrome === null) return;
  site = await servePage();
  harness = await startHubWithMachine({
    hubPort: HUB_PORT,
    machinePort: MACHINE_PORT,
    model: MODEL,
  });
});

test.afterAll(async () => {
  site?.close();
  await harness?.admin.dispose();
  await harness?.stop();
});

test("a conversation on a machine shows that machine's Chrome, and a click in the panel reaches the page the agent opened", async ({
  page,
}) => {
  test.skip(chrome === null, "no Chrome on this box for the machine to run");
  test.setTimeout(180_000);
  const { base, projectId, machineId, admin } = harness;
  const onMachine = (rest) => `${base}/server/${machineId}${rest}`;

  // The machine's Chrome is named rather than looked for, so the run does not depend on PATH.
  const settings = await admin.put(onMachine("/api/builtin-browser/settings"), {
    data: { chromePath: chrome },
  });
  expect(settings.ok(), await settings.text()).toBeTruthy();

  // A Session whose Workspace is on the machine: created there, through the hub.
  const created = await admin.post(
    onMachine(`/api/projects/${projectId}/agents/default_agent/sessions`),
    { data: { provider: "custom", modelId: "claude-4-8" } },
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  const sessionId = (await created.json()).session.sessionId;

  // The picture travels as an event stream through the hub's proxy to the machine.
  const viewRequests = [];
  page.on("request", (req) => {
    if (/\/api\/builtin-browser\/tabs\/\d+\/view/.test(req.url())) viewRequests.push(req.url());
  });

  const login = await page.request.post(`${base}/api/auth/login`, {
    data: { userId: "admin", password: "penguin-2026" },
  });
  expect(login.ok(), "login").toBeTruthy();
  await page.goto(`${base}/chat/${sessionId}`);
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.waitFor();

  // The panel is the machine's: its own Chrome, ready, nothing open. The hub's is not shown.
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-builtin-browser").click();
  const panel = page.getByTestId("hosted-browser-panel");
  await expect(panel).toHaveAttribute("data-standing", "ready");
  await expect(panel.getByTestId("hosted-browser-empty")).toContainText("还没有打开的页面");
  await expect(page.getByTestId("browser-chrome-surface")).toHaveCount(0);

  // The agent opens the page on the machine's loopback from the Session's shell.
  await composer.fill(`files rewrite test penguin browser open ${site.url}`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("The file was rewritten.")).toHaveCount(1, { timeout: 60_000 });

  // The tab and its picture: the page's own red, on the half the button does not cover too.
  await expect(panel.getByRole("tab", { name: /Machine page/ })).toBeVisible();
  const surface = panel.getByTestId("hosted-browser-surface");
  await expect(surface).toHaveAttribute("data-phase", "live");
  const picture = panel.getByTestId("hosted-browser-picture");
  await expect.poll(async () => isRed(await pixelAt(picture, 0.25, 0.5))).toBe(true);
  expect(isRed(await pixelAt(picture, 0.75, 0.9))).toBe(true);
  expect(viewRequests.length).toBeGreaterThan(0);
  for (const url of viewRequests) expect(url).toContain(`/server/${machineId}/api/`);
  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, "browser-on-machine-page.png") });
  }

  // A person clicks the page's button in the panel; the page changes, and the picture with it.
  const box = await surface.boundingBox();
  await surface.click({ position: { x: box.width * 0.75, y: box.height * 0.5 } });
  await expect.poll(async () => isGreen(await pixelAt(picture, 0.25, 0.5))).toBe(true);
  await expect(panel.getByRole("tab", { name: /Pressed/ })).toBeVisible();
  if (SHOT_DIR) {
    await page.screenshot({ path: path.join(SHOT_DIR, "browser-on-machine-clicked.png") });
  }

  // The agent reads the page as the click left it.
  await composer.fill("files rewrite test penguin browser scan");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("The file was rewritten.")).toHaveCount(2, { timeout: 60_000 });
  const messages = await admin.get(onMachine(`/api/sessions/${sessionId}/messages`));
  expect(messages.ok(), await messages.text()).toBeTruthy();
  const transcript = await messages.text();
  expect(transcript).toContain("pressed by a person");

  // Nothing of it touched the hub's own browser.
  const hub = await (await admin.get(`${base}/api/builtin-browser/status`)).json();
  expect(hub.tabs).toEqual([]);
  expect(hub.backend).not.toBe("hosted");
});
