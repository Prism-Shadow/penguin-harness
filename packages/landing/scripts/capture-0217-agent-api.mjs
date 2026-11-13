/**
 * Capture the 0.2.17 screenshot of the Agent API: an agent's API tab with the API on and a key
 * minted, and a Try it run streamed into the tab, its records labelled by `payload.type` and the
 * outcome strip under them.
 *
 *   penguinharness-0-2-17-agent-api-{en,zh}.png
 *
 * Only the model is mocked (OpenAI chat-completions SSE): the agent really runs `date` in its
 * Workspace, and the time it answers with is the one that command printed.
 *
 *   node scripts/capture-0217-agent-api.mjs serve   # mock model + server, API on, a key
 *   node scripts/capture-0217-agent-api.mjs shots   # drives the running server
 *
 * `serve` writes the key it minted to $SHOT_SCRATCH/agent-key (mode 0600) and stays up, so curl
 * and the @prismshadow/amsp client can be run against the same server before `shots`.
 *
 * The clock: with SHOT_FAKETIME_LIB pointing at libfaketime.so.1, the server (and every command
 * it runs) is started with its clock moved to SHOT_NOW (default the release morning), and the
 * page clock is pinned to the same moment, so `date`, the Session id and the times on the page
 * all read that day. Without it the shots carry the real time.
 *
 * Env: SHOT_SCRATCH (data/, out/, debug/), SRV_PORT (7364), MOCK_PORT (19133), SHOT_FONTCONFIG,
 * SHOT_FAKETIME_LIB, SHOT_NOW, SHOT_ONLY (stages: try), and for review only SHOT_DARK=1 (dark
 * theme) and SHOT_HOVER=1 (a control hovered).
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODE = process.argv[2] ?? "shots";
const SCRATCH = process.env.SHOT_SCRATCH ?? path.join(ROOT, ".shots-0217-agent-api");
const OUT_DIR = path.join(SCRATCH, "out");
// The release's default port, so the tab's Base URL reads http://localhost:7364/api/amsp/v1 as
// it does on a reader's own server.
const SRV_PORT = Number(process.env.SRV_PORT ?? 7364);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 19133);
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-agent-api-0217";
const AGENT = "default_agent";
const KEY_NAME = "nightly-report";
const NOW = new Date(process.env.SHOT_NOW ?? "2026-10-26T10:30:00+08:00");
// Review variants, never published: the dark theme, and the session id's copy button hovered.
const DARK = process.env.SHOT_DARK === "1";
const HOVER = process.env.SHOT_HOVER === "1";
const ONLY = new Set((process.env.SHOT_ONLY ?? "").split(",").filter(Boolean));
const stage = (name) => ONLY.size === 0 || ONLY.has(name);

// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------

const OFFSET_FILE = path.join(SCRATCH, "clock-offset");

/** The environment that moves a process's clock by `offsetSec`, or nothing without the library. */
function fakeClockEnv(offsetSec) {
  const lib = process.env.SHOT_FAKETIME_LIB;
  if (!lib || !existsSync(lib)) return {};
  return {
    LD_PRELOAD: lib,
    FAKETIME: `${offsetSec >= 0 ? "+" : ""}${offsetSec}`,
    // Timers run on the monotonic clock; only the wall clock moves.
    FAKETIME_DONT_FAKE_MONOTONIC: "1",
  };
}

/** The page's "now": the server's moved clock when `serve` moved it, else the real one. */
function pageNow() {
  try {
    const offset = Number(readFileSync(OFFSET_FILE, "utf8"));
    if (Number.isFinite(offset) && offset !== 0) return new Date(Date.now() + offset * 1000);
  } catch {}
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Mock model. The agent asks the machine for the time; the answer quotes what `date` printed.
// ---------------------------------------------------------------------------

const ASKS = {
  en: { time: /What time is it/, title: "Current server time" },
  zh: { time: /现在几点/, title: "查询服务器时间" },
};
const CLOCK = { en: "Read the server's clock", zh: "读取服务器时钟" };

/** `date` in the C locale: "Mon Oct 26 10:30:12 CST 2026" → its parts. */
function parseDate(text) {
  const m = /(\w{3}) (\w{3}) +(\d+) (\d\d):(\d\d):(\d\d) (\w+) (\d{4})/.exec(text);
  if (m === null) return null;
  const [, , mon, day, hh, mm, , zone, year] = m;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(mon) / 3;
  return { hh, mm, day: +day, month, year: +year, zone };
}

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );

function decideTurn(messages) {
  const flat = JSON.stringify(messages);
  if (flat.includes("You are a title generator")) {
    return { title: /现在几点/.test(flat) ? ASKS.zh.title : ASKS.en.title };
  }
  const lang = /现在几点/.test(flat) ? "zh" : "en";
  const last = JSON.stringify(messages.filter((m) => m.role === "user").at(-1) ?? {});
  const lastIsTool = messages.at(-1)?.role === "tool";
  const tools = messages.filter((m) => m.role === "tool");
  const clock = tools.length > 0 ? parseDate(JSON.stringify(tools.at(-1).content)) : null;
  if (!lastIsTool && ASKS[lang].time.test(last)) {
    return { call: { name: "exec_command", args: { description: CLOCK[lang], cmd: "date" } } };
  }
  if (lastIsTool && clock !== null) {
    const l = clock;
    return {
      text:
        lang === "zh"
          ? `现在是 ${l.year} 年 ${l.month + 1} 月 ${l.day} 日 ${l.hh}:${l.mm}（服务器时间，${l.zone}）。`
          : `It's ${l.hh}:${l.mm} on ${MONTHS[l.month]} ${l.day}, ${l.year}, by the server's clock (${l.zone}).`,
    };
  }
  return { text: lang === "zh" ? "好的。" : "OK." };
}

/** A provider's pace: a wait before the first token, then a steady stream. */
const FIRST_TOKEN_MS = 900;
const CHUNK_MS = 45;

async function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const turn = decideTurn(messages);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finish = null, usage) => {
    const payload = {
      id: "chatcmpl-shot",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const done = (reason) => {
    const prompt = 2400 + 300 * messages.length;
    chunk({}, reason, {
      prompt_tokens: prompt,
      completion_tokens: 48,
      total_tokens: prompt + 48,
      prompt_tokens_details: { cached_tokens: prompt - 512 },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  };
  chunk({ role: "assistant" });
  if (turn.title !== undefined) {
    chunk({ content: turn.title });
    done("stop");
    return;
  }
  await sleep(FIRST_TOKEN_MS);
  if (turn.call) {
    chunk({
      tool_calls: [
        {
          index: 0,
          // A provider-style id, as a real model sends one.
          id: `call_${randomBytes(12).toString("hex")}`,
          type: "function",
          function: { name: turn.call.name, arguments: "" },
        },
      ],
    });
    for (const part of JSON.stringify(turn.call.args).match(/[\s\S]{1,24}/g) ?? []) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
      await sleep(CHUNK_MS);
    }
    done("tool_calls");
    return;
  }
  for (const part of turn.text.match(/[\s\S]{1,16}/g) ?? []) {
    chunk({ content: part });
    await sleep(CHUNK_MS);
  }
  done("stop");
}

function startMock() {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {}
      if (req.url?.includes("chat/completions")) return void openaiReply(res, json);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server and API helpers.
// ---------------------------------------------------------------------------

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server not ready: ${url}`);
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(password) {
  const { setCookie } = await api(null, "POST", "/api/auth/login", { userId: "admin", password });
  if (!setCookie) throw new Error("no session cookie from login");
  return setCookie.split(";")[0];
}

async function serve() {
  const dataRoot = path.join(SCRATCH, "data");
  mkdirSync(dataRoot, { recursive: true });
  const offset = Math.round((NOW.getTime() - Date.now()) / 1000);
  const clockEnv = fakeClockEnv(offset);
  writeFileSync(OFFSET_FILE, String(clockEnv.FAKETIME ? offset : 0));
  const mock = await startMock();
  const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
    env: {
      ...process.env,
      ...clockEnv,
      // `date` prints in the C locale, which the mock reads back.
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PENGUIN_HOME: dataRoot,
      PENGUIN_WEB_DB: path.join(dataRoot, "web.db"),
      PENGUIN_WEB_DIST: path.join(ROOT, "packages/web/dist"),
      PORT: String(SRV_PORT),
      HOST: "127.0.0.1",
      PENGUIN_SEED_ADMIN_PASSWORD: SEED_PASSWORD,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const stop = () => {
    try {
      srv.kill();
    } catch {}
    mock.close();
  };
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  process.on("exit", stop);
  srv.on("exit", (code) => {
    console.log(`[agent-api] server exited ${code}`);
    process.exit(1);
  });
  await waitFor(`${BASE}/`);
  // The admin is seeded just after the server starts answering; rotate its password once, or
  // a banner covers the top of every shot.
  let cookie = null;
  for (let i = 0; i < 60 && cookie === null; i++) {
    cookie = await login(ADMIN_PASSWORD).catch(() => null);
    if (cookie !== null) break;
    const seeded = await login(SEED_PASSWORD).catch(() => null);
    if (seeded !== null) {
      await api(seeded, "PUT", "/api/me/password", {
        oldPassword: SEED_PASSWORD,
        newPassword: ADMIN_PASSWORD,
      });
      continue;
    }
    await sleep(1000);
  }
  if (cookie === null) throw new Error("cannot sign in as admin");
  const projectId = (await api(cookie, "GET", "/api/projects")).json.projects[0].projectId;
  await api(cookie, "PUT", `/api/projects/${projectId}/models`, {
    defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    models: [
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        clientType: "openai-chat",
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
      },
    ],
  });
  const apiPath = `/api/projects/${projectId}/agents/${AGENT}/api`;
  await api(cookie, "PUT", apiPath, { enabled: true });
  const settings = (await api(cookie, "GET", apiPath)).json;
  if (!(settings.api?.keys ?? []).some((k) => k.name === KEY_NAME)) {
    const created = (await api(cookie, "POST", `${apiPath}/keys`, { name: KEY_NAME })).json;
    writeFileSync(path.join(SCRATCH, "agent-key"), `${created.secret}\n`, { mode: 0o600 });
  }
  console.log(`[agent-api] server ready on ${BASE}, agent ${projectId}/${AGENT}`);
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Shots.
// ---------------------------------------------------------------------------

const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");
/** The UI words the flow reads or clicks, verbatim from the web dictionaries. */
const T = {
  en: { enable: "Enable API access", tryIt: "Try it", example: "What time is it now?", run: "Run" },
  zh: { enable: "开启 API 访问", tryIt: "试一试", example: "现在几点了？", run: "运行" },
};

async function shots() {
  const { chromium } = await import("@playwright/test");
  mkdirSync(OUT_DIR, { recursive: true });
  const cookie = await login(ADMIN_PASSWORD);
  const projectId = (await api(cookie, "GET", "/api/projects")).json.projects[0].projectId;
  const now = pageNow();
  const browser = await chromium.launch({
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      ...(process.env.SHOT_FONTCONFIG ? { FONTCONFIG_FILE: process.env.SHOT_FONTCONFIG } : {}),
    },
  });
  const pages = [];

  async function openPage(lang, url, viewport) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: lang === "zh" ? "zh-CN" : "en-US",
      timezoneId: "Asia/Shanghai",
      colorScheme: DARK ? "dark" : "light",
    });
    await context.addInitScript(
      ([l, p, dark]) => {
        localStorage.setItem("penguin.lang", l);
        localStorage.setItem("penguin.themeId", "modern");
        localStorage.setItem("penguin.theme", dark ? "dark" : "light");
        localStorage.setItem("penguin.lastProjectId", p);
        localStorage.setItem("penguin.dock.launcherHidden", "1");
      },
      [lang, projectId, DARK],
    );
    const page = await context.newPage();
    pages.push({ lang, page });
    if (now !== null) await page.clock.install({ time: now });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const res = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: "admin", password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    return page;
  }

  async function clipAround(page, locators, pad = 16) {
    const boxes = [];
    for (const l of locators) boxes.push(await l.boundingBox());
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  async function save(page, name, clip) {
    await page.screenshot({ path: path.join(OUT_DIR, name), ...(clip ? { clip } : {}) });
    console.log(`[agent-api] ${name}`);
  }

  async function debug(page, tag) {
    const dir = path.join(SCRATCH, "debug");
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${tag}.png`), fullPage: true }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    writeFileSync(path.join(dir, `${tag}.txt`), text);
  }

  const suffix = `${DARK ? "-dark" : ""}${HOVER ? "-hover" : ""}`;
  try {
    for (const lang of LANGS) {
      const t = T[lang];
      const page = await openPage(lang, `/agents/${AGENT}?tab=api`, { width: 1440, height: 2600 });
      await page.getByText(t.enable, { exact: true }).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);

      // Try it: one real run through the same route a program calls.
      if (stage("try")) {
        const panel = page.locator("section").filter({ hasText: t.tryIt }).last();
        await panel.scrollIntoViewIfNeeded();
        const input = panel.getByRole("textbox", { name: t.tryIt });
        await input.fill(t.example);
        await panel.getByRole("button", { name: t.run, exact: true }).click();
        const foot = panel.locator('[data-slot="foot"]');
        await foot.getByText("completed").waitFor({ timeout: 60000 });
        await page.mouse.move(5, 5);
        await page.waitForTimeout(1200);
        // The output stays at its end after a run, as the tab leaves it. It is a scroll box of a
        // fixed height: nudge it (within its bottom padding) so neither edge cuts a row in half.
        await panel.getByTestId("api-try-output").evaluate((box) => {
          const rows = [...box.querySelectorAll('[data-testid="api-try-row"]')];
          const max = box.scrollHeight - box.clientHeight;
          const cuts = () => {
            const edge = box.getBoundingClientRect();
            return rows.some((row) => {
              const r = row.getBoundingClientRect();
              const across = (y) => r.top < y - 0.5 && r.bottom > y + 0.5;
              return across(edge.top) || across(edge.bottom);
            });
          };
          for (let s = max; s >= Math.max(0, max - 12); s--) {
            box.scrollTop = s;
            if (!cuts()) return;
          }
          box.scrollTop = max;
        });
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        if (HOVER) {
          await panel
            .getByRole("button", { name: /session_id/ })
            .first()
            .hover();
          await page.waitForTimeout(900);
        }
        const clip = await clipAround(page, [panel], 16);
        await save(page, `penguinharness-0-2-17-agent-api-${lang}${suffix}.png`, clip);
        writeFileSync(
          path.join(OUT_DIR, `penguinharness-0-2-17-agent-api-${lang}${suffix}.txt`),
          await panel.evaluate((el) => el.innerText),
        );
      }
      await debug(page, `tab-${lang}${suffix}`);
    }
  } catch (err) {
    for (const { lang, page } of pages) await debug(page, `fail-${lang}${suffix}`);
    throw err;
  } finally {
    await browser.close();
  }
}

if (MODE === "serve") {
  await serve();
} else {
  await shots();
  process.exit(0);
}
