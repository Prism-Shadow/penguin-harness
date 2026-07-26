/**
 * Capture blog-post screenshots of the product's Models page (the free-model rows).
 *
 * A deliberately lean sibling of capture-shots.mjs: that script drives a full scripted
 * LLM conversation for the landing hero shots, while the Models page needs no LLM at
 * all — a fresh user's default Project already presets the entire built-in model
 * catalog, so the free rows (Ling 3.0 Flash / Nemotron 3 Ultra / Laguna M.1 /
 * openrouter/free) render their light-yellow "Free" badges straight from the $0
 * pricing. Flow: boot the Web server against a temp data root serving the built web
 * dist -> provision one demo user per UI language (password rotated once so the
 * initial-password banner never shows) -> open /models, scroll the OpenRouter group
 * to the top of the viewport (Claude Opus 5 sits on its first card row, the free
 * rows a few rows below) -> screenshot, light theme, zh + en, into
 * public/blog-assets/ as free-models-page-<lang>-light.webp (re-encoded to WebP
 * inside Chromium, same as capture-shots.mjs).
 *
 * Prereqs: `pnpm --filter @prismshadow/penguin-{skills,core,server,web} build` and
 * Playwright's chromium. Run: `node scripts/capture-blog-shots.mjs` (or
 * `pnpm --filter @prismshadow/penguin-landing blog-shots`).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT_DIR = path.resolve(HERE, "../public/blog-assets");
const SRV_PORT = 8944; // Distinct from capture-shots.mjs (8940/8941) so both can run.
// On loopback binds the App is canonically served on `localhost`; the 127.0.0.1
// counterpart is the Workspace-preview host, where /api deliberately answers 401
// (see server app.ts's canonical-host guard).
const BASE = `http://localhost:${SRV_PORT}`;

// ---------------------------------------------------------------------------
// Server + API helpers (same shape as capture-shots.mjs).
// ---------------------------------------------------------------------------

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(userId, password) {
  const { setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  if (!setCookie) throw new Error("no session cookie from login");
  return setCookie.split(";")[0];
}

/**
 * Per-language demo user (same ids as capture-shots.mjs). Unlike that script it does NOT
 * touch the model table: the fresh Project's preset catalog is exactly what the shot is
 * about. The password is rotated once so the initial-password banner stays out of frame.
 */
async function provisionUser(adminCookie, lang) {
  const userId = lang === "zh" ? "demo" : "alex";
  const initial = `${userId}12345`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let password = initial;
  const cookie = await login(userId, initial);
  try {
    await api(cookie, "PUT", "/api/me/password", {
      oldPassword: initial,
      newPassword: `penguin-${userId}-2026`,
    });
    password = `penguin-${userId}-2026`;
  } catch {}
  return { userId, password };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const dataRoot = mkdtempSync(path.join(os.tmpdir(), "penguin-blog-shots-"));
mkdirSync(OUT_DIR, { recursive: true });

const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    PENGUIN_HOME: path.join(dataRoot, "home"),
    PENGUIN_WEB_DB: path.join(dataRoot, "web.db"),
    PENGUIN_WEB_DIST: path.join(ROOT, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
process.on("exit", () => {
  try {
    srv.kill();
  } catch {}
});

try {
  await waitFor(`${BASE}/`);
  console.log(`[blog-shots] server ready on ${BASE}`);

  const adminCookie = await login("admin", "penguin-2026");
  const browser = await chromium.launch();

  // WebP encoder: Chromium re-encodes the PNG screenshot buffer via canvas (same
  // convention and quality as capture-shots.mjs, keeping repo assets small).
  const encoderPage = await browser.newPage();
  async function saveWebp(pngBuffer, fileName) {
    const dataUrl = await encoderPage.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/webp", 0.82);
    }, pngBuffer.toString("base64"));
    writeFileSync(path.join(OUT_DIR, fileName), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`[blog-shots] ${fileName}`);
  }

  for (const lang of ["zh", "en"]) {
    const user = await provisionUser(adminCookie, lang);

    // 1280x900 @1.5x, light theme (the blog embeds a single light variant per language,
    // like rag-app-<lang>-light.webp): tall enough that the OpenRouter group shows Claude
    // Opus 5 (first card row) together with the free rows and their badges.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1.5,
      locale: lang === "zh" ? "zh-CN" : "en-US",
    });
    await context.addInitScript(
      ([t, l]) => {
        localStorage.setItem("penguin.theme", t);
        localStorage.setItem("penguin.lang", l);
      },
      ["light", lang],
    );
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: user.userId, password: user.password },
    });
    if (!loginRes.ok()) throw new Error(`browser login failed: ${loginRes.status()}`);

    await page.goto(`${BASE}/models`);
    // The catalog is loaded once a free row's card is rendered (its "Free" badge with it).
    const lingCard = page.getByText("Ling 3.0 Flash (free)").first();
    await lingCard.waitFor({ timeout: 20000 });
    // Scroll the OpenRouter group section to the top of the viewport so the group header,
    // Claude Opus 5 (first card row) and the badged free rows all sit in frame.
    await page
      .getByRole("button", { name: /OpenRouter/ })
      .first()
      .evaluate((el) =>
        el.closest("section").scrollIntoView({ block: "start", behavior: "instant" }),
      );
    await page.waitForTimeout(1200);
    await saveWebp(await page.screenshot(), `free-models-page-${lang}-light.webp`);

    await context.close();
  }

  await browser.close();
  console.log(`[blog-shots] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[blog-shots] FAILED:", err);
  process.exit(1);
}
