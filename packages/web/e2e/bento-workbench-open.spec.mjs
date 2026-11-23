// Walk the installed app from its real tile, then reopen the document through the full page.
import { test, expect, _electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { provisionAndLogin } from "./auth.mjs";

test("the Slides window and full page render a saved deck in the nested editor", async ({
  page,
}, info) => {
  const base = process.env.BASE_URL;
  await provisionAndLogin(page.request, "bentowindowuser", "password123");
  await verifySlides(page, base, info);
});

test("the source desktop renders the start page and reopens the actual Bento editor", async ({}, info) => {
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
    args: [desktop, "--user-data-dir=" + path.join(scratch, "profile")],
    env: {
      ...process.env,
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
    await verifySlides(page, base, info);
  } finally {
    await shell.close();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function verifySlides(page, base, info) {
  const entries = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("/workbenches/slides/"))
      entries.push([req.method(), new URL(req.url()).pathname, req.failure()?.errorText]);
  });
  page.on("response", (res) => {
    if (res.url().includes("/workbenches/slides/"))
      entries.push([res.status(), new URL(res.url()).pathname, res.headers()["content-type"]]);
  });
  try {
    const projects = await page.request.get(base + "/api/projects");
    expect(projects.ok(), await projects.text()).toBe(true);
    const project = (await projects.json()).projects[0].projectId;
    const api = base + "/api/projects/" + project + "/agents/default_agent";
    const installed = await page.request.post(api + "/plugins", {
      data: { names: ["use-bento-slides"] },
    });
    expect(installed.ok(), await installed.text()).toBe(true);
    await page.goto(base + "/apps");
    await page
      .getByRole("button", { name: /AI (Slides|PPT)/ })
      .first()
      .click();
    const frame = page.frameLocator("iframe[src*='/workbenches/slides/ui/']:visible");
    const start = frame.locator("#start-sample");
    await expect(start).toBeVisible();
    const decks = api + "/workbenches/slides/api/decks";
    const initial = await page.request.get(decks);
    expect(initial.ok(), await initial.text()).toBe(true);
    expect((await initial.json()).decks).toHaveLength(0);
    await start.click();
    const editor = frame.frameLocator("#editor");
    const cover = editor
      .getByText(/^(An agent that keeps getting better at your work\.|越用越懂你工作的智能体)$/)
      .last();
    await expect(cover).toBeVisible();
    await expect(editor.locator(".ed-thumb").first()).toBeVisible();
    await expect(frame.locator("#editor")).not.toHaveAttribute("inert", "");
    const saved = await page.request.get(decks);
    const name = (await saved.json()).decks[0].title;
    await page.goto(base + "/app/" + project + "/default_agent/slides/main");
    const recent = frame.locator("[data-open-deck]").filter({ hasText: name });
    await recent.click();
    await expect(cover).toBeVisible();
    await expect(editor.locator(".ed-thumb").first()).toBeVisible();
    await expect(frame.locator("#editor")).not.toHaveAttribute("inert", "");
  } finally {
    const frames = await Promise.all(
      page.frames().map(async (f) => ({
        url: f.url().split("?")[0],
        state: await f
          .evaluate(() => ({
            title: document.title,
            ready: document.readyState,
            view: document.querySelector("#app")?.dataset.view,
            iframes: [...document.querySelectorAll("iframe")].map((i) => ({
              src: i.getAttribute("src")?.split("?")[0],
              srcdocBytes: i.srcdoc.length,
            })),
            thumbnails: document.querySelectorAll(".ed-thumb").length,
            scripts: [...document.scripts]
              .map((script) => script.src && new URL(script.src).pathname)
              .filter(Boolean),
          }))
          .catch(() => null),
      })),
    );
    const details = JSON.stringify(
      { os: process.platform, frames, requests: entries, errors },
      null,
      2,
    );
    console.log("Bento page state", details);
    await info.attach("bento-rendering-state", { body: details, contentType: "application/json" });
    await info.attach("bento-rendering", {
      body: await page.screenshot({ timeout: 3000 }),
      contentType: "image/png",
    });
  }
}
