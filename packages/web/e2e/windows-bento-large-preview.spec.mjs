// Walk the installed app from its real tile, then reopen the document through the full page.
import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { provisionAndLogin } from "./auth.mjs";

test("the browser previews the same large export in both workspace contexts", async ({
  page,
}, info) => {
  const base = process.env.BASE_URL;
  await provisionAndLogin(page.request, "bentowindowuser", "password123");
  await verifyExport(page, base);
});

test("the source desktop previews the same large export in both workspace contexts", async ({}, info) => {
  test.skip(
    !process.env.BENTO_DESKTOP,
    "Start the built desktop and its embedded server explicitly.",
  );
  test.setTimeout(145_000);
  const desktop = fileURLToPath(new URL("../../desktop/", import.meta.url));
  const require = createRequire(path.join(desktop, "package.json"));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bento-render-"));
  const shell = await _electron.launch({
    executablePath: require("electron"),
    cwd: desktop,
    args: [".", "--user-data-dir=" + path.join(scratch, "profile")],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      PENGUIN_HOME: path.join(scratch, "data"),
      PENGUIN_SEED_ADMIN_PASSWORD: "penguin-2026",
      XDG_CONFIG_HOME: path.join(scratch, "prefs"),
    },
    timeout: 75_000,
  });
  try {
    const page = await shell.firstWindow({ timeout: 75_000 });
    await page.waitForURL(/^http:\/\/localhost:\d+\//, { timeout: 45_000 });
    const base = new URL(page.url()).origin;
    console.log(
      "Desktop host",
      await shell.evaluate(() => ({ os: process.platform, version: process.versions.electron })),
    );
    await verifyExport(page, base);
  } finally {
    await shell.close();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function verifyExport(page, base) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bento-export-"));
  try {
    const dir = path.join(root, "设计 meeting");
    await fs.mkdir(dir);

    const proj = (await (await page.request.get(base + "/api/projects")).json()).projects[0]
      .projectId;
    const project = base + "/api/projects/" + proj;
    const agent = project + "/agents/default_agent";
    await expect(
      await page.request.put(project + "/models", {
        data: {
          defaultModel: { provider: "custom", modelId: "claude-bento" },
          models: [
            {
              modelId: "claude-bento",
              provider: "custom",
              apiKey: "sk-mock",
              baseUrl: process.env.MOCK_URL || "http://127.0.0.1:1",
              contextWindow: 20000,
            },
          ],
        },
      }),
    ).toBeOK();
    await expect(
      await page.request.post(agent + "/plugins", { data: { names: ["use-bento-slides"] } }),
    ).toBeOK();
    const ui = agent + "/workbenches/slides/ui/";
    const sample = await (await page.request.get(ui + "sample.bento.json")).json();
    await page.goto(base + "/app/" + proj + "/default_agent/slides/main");
    const pic = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 384;
      const ctx = c.getContext("2d");
      const image = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < image.data.length; i += 65536)
        crypto.getRandomValues(image.data.subarray(i, i + 65536));
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      ctx.putImageData(image, 0, 0);
      return c.toDataURL();
    });
    sample.assets = { ...sample.assets, photo: pic };
    sample.title = "复盘 Winter meeting";
    sample.slides[1].elements.push({
      id: "coverphoto",
      type: "image",
      src: "asset:photo",
      x: 10,
      y: 10,
      w: 300,
      h: 200,
    });
    const api = agent + "/workbenches/slides/api";
    await expect(
      await page.request.post(api + "/decks", {
        data: { id: "design-meeting", text: JSON.stringify(sample) },
      }),
    ).toBeOK();
    const app = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
    await app.locator("[data-open-deck]").filter({ hasText: sample.title }).click();
    await expect(app.frameLocator("#editor").locator(".ed-thumb")).toHaveCount(4);
    await app.locator("#file-button").click();
    const [down] = await Promise.all([
      page.waitForEvent("download"),
      app.locator("#export").click(),
    ]);
    const name = down.suggestedFilename();
    await down.saveAs(path.join(dir, name));
    const bytes = (await fs.stat(path.join(dir, name))).size;
    expect(bytes).toBeGreaterThan(1048576);
    const sid = (
      await (await page.request.post(agent + "/sessions", { data: { workspace: dir } })).json()
    ).session.sessionId;
    await page.goto(base + "/chat/" + sid);
    await page.getByTestId("dock-toggle-right").click();
    await page.getByTestId("dock-pick-workspace").click();
    let dock = page.getByTestId("dock");
    await dock.locator('[data-tree-path="' + name + '"]').click();
    const output = dock.frameLocator('iframe[title="' + name + '"]');
    await expect(output.locator(".ed-title")).toHaveValue(sample.title);
    await expect(output.locator(".ed-thumb")).toHaveCount(4);
    console.log(
      "LARGE EXPORT SESSION OK",
      bytes,
      dir.split(path.sep).pop(),
      name,
      await output.locator(".ed-thumb").count(),
    );
    const other = path.join(root, "not-the-export-folder");
    await fs.mkdir(other);
    const otherSid = (
      await (await page.request.post(agent + "/sessions", { data: { workspace: other } })).json()
    ).session.sessionId;
    await page.goto(base + "/chat/" + otherSid);
    await page.getByText("设计 meeting", { exact: true }).first().hover();
    await page
      .locator('div[class*="group/header"]')
      .filter({ hasText: "设计 meeting" })
      .getByRole("button", { name: /^(工作区选项|Workspace options)$/ })
      .click();
    await page.getByRole("menuitem", { name: /^(打开文件浏览|Browse files)$/ }).click();
    await expect(page).toHaveURL(/\/chat\/new/);
    dock = page.getByTestId("dock");
    await dock.locator('[data-tree-path="' + name + '"]').click();
    const file = dock.locator('iframe[title="' + name + '"]');
    await expect(file).toBeAttached();
    console.log(
      "LARGE EXPORT DIRECTORY",
      await file.evaluate((e) => ({
        length: e.srcdoc.length,
        endsWithLoader: e.srcdoc.includes("every loader path was refused"),
        src: e.src,
      })),
      await output.locator(".ed-thumb").count(),
    );
    await expect(output.locator(".ed-title")).toHaveValue(sample.title, { timeout: 4000 });
    await expect(output.locator(".ed-thumb")).toHaveCount(4);
    console.log("LARGE EXPORT DIRECTORY OK", bytes, await output.locator(".ed-thumb").count());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
