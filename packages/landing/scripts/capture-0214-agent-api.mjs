/**
 * Capture the 0.2.14 screenshots of the Agent API: an agent's API tab with the API on and a
 * key minted, and a Try it run streamed into the tab.
 *
 * Only the model is mocked (OpenAI chat-completions SSE): the agent really runs `date` in its
 * Workspace, and the time it answers with is the one that command printed.
 *
 *   node scripts/capture-0214-agent-api.mjs serve   # mock model + server, API on, a key
 *   node scripts/capture-0214-agent-api.mjs shots   # drives the running server
 *
 * `serve` writes the key it minted to $SHOT_SCRATCH/agent-key (mode 0600) and stays up, so
 * curl and the @prismshadow/amsp client can be run against the same server before `shots`
 * (whose key list then shows when the key was last used).
 *
 * Env: SHOT_SCRATCH (data/, out/, debug/), SRV_PORT (7364), MOCK_PORT (19133),
 * SHOT_FONTCONFIG, SHOT_ONLY (comma list of stages: tab, try).
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODE = process.argv[2] ?? "shots";
const SCRATCH = process.env.SHOT_SCRATCH ?? path.join(ROOT, ".shots-0214-agent-api");
const OUT_DIR = path.join(SCRATCH, "out");
// The release's default port, so the tab's Base URL reads http://localhost:7364/api/amsp/v1 as
// it does on a reader's own server.
const SRV_PORT = Number(process.env.SRV_PORT ?? 7364);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 19133);
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-agent-api-2026";
const AGENT = "default_agent";
const KEY_NAME = "nightly-report";
const ONLY = new Set((process.env.SHOT_ONLY ?? "").split(",").filter(Boolean));
const stage = (name) => ONLY.size === 0 || ONLY.has(name);

// ---------------------------------------------------------------------------
// Mock model. The agent asks the machine for the time; the answer quotes what `date` printed.
// ---------------------------------------------------------------------------

const ASKS = {
  en: { time: /What time is it/, utc: /in UTC\?/, title: "Current server time" },
  zh: { time: /现在几点/, utc: /UTC/, title: "查询服务器时间" },
};
const CLOCK = { en: "Read the server's clock", zh: "读取服务器时钟" };

/** `date` in the C locale: "Tue Oct 13 01:30:12 CST 2026" → its parts. */
function parseDate(text) {
  const m = /(\w{3}) (\w{3}) +(\d+) (\d\d):(\d\d):(\d\d) (\w+) (\d{4})/.exec(text);
  if (m === null) return null;
  const [, , mon, day, hh, mm, ss, zone, year] = m;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(mon) / 3;
  // The test host runs on China Standard Time.
  const offset = zone === "CST" ? 8 : 0;
  const utc = new Date(Date.UTC(+year, month, +day, +hh - offset, +mm, +ss));
  return { local: { hh, mm, day: +day, month, year: +year, zone }, utc };
}

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );
const WEEKDAYS = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" ");

function decideTurn(messages) {
  const flat = JSON.stringify(messages);
  if (flat.includes("You are a title generator")) {
    return { title: /现在几点/.test(flat) ? ASKS.zh.title : ASKS.en.title };
  }
  const lang = /现在几点|UTC 时间/.test(flat) ? "zh" : "en";
  const users = messages.filter((m) => m.role === "user");
  const last = JSON.stringify(users.at(-1) ?? {});
  const lastIsTool = messages.at(-1)?.role === "tool";
  const tools = messages.filter((m) => m.role === "tool");
  const clock = tools.length > 0 ? parseDate(JSON.stringify(tools.at(-1).content)) : null;
  if (!lastIsTool && ASKS[lang].utc.test(last) && clock !== null) {
    const u = clock.utc;
    const hm = `${String(u.getUTCHours()).padStart(2, "0")}:${String(u.getUTCMinutes()).padStart(2, "0")}`;
    return {
      text:
        lang === "zh"
          ? `UTC 时间是 ${u.getUTCMonth() + 1} 月 ${u.getUTCDate()} 日 ${hm}。`
          : `That is ${hm} UTC on ${WEEKDAYS[u.getUTCDay()]}, ${MONTHS[u.getUTCMonth()]} ${u.getUTCDate()}.`,
    };
  }
  if (!lastIsTool && ASKS[lang].time.test(last)) {
    return { call: { name: "exec_command", args: { description: CLOCK[lang], cmd: "date" } } };
  }
  if (lastIsTool && clock !== null) {
    const l = clock.local;
    return {
      text:
        lang === "zh"
          ? `现在是 ${l.year} 年 ${l.month + 1} 月 ${l.day} 日 ${l.hh}:${l.mm}（服务器时间，${l.zone}）。`
          : `It's ${l.hh}:${l.mm} on ${MONTHS[l.month]} ${l.day}, ${l.year}, by the server's clock (${l.zone}).`,
    };
  }
  return { text: "OK." };
}

function openaiReply(res, body) {
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
  if (turn.call) {
    chunk({
      tool_calls: [
        {
          index: 0,
          // A provider-style id; the curl transcript in the tutorial prints it.
          id: `call_${randomBytes(12).toString("hex")}`,
          type: "function",
          function: { name: turn.call.name, arguments: "" },
        },
      ],
    });
    for (const part of JSON.stringify(turn.call.args).match(/[\s\S]{1,24}/g) ?? []) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    }
    done("tool_calls");
    return;
  }
  for (const part of turn.text.match(/[\s\S]{1,16}/g) ?? []) chunk({ content: part });
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
      if (req.url?.includes("chat/completions")) return openaiReply(res, json);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server and API helpers.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const mock = await startMock();
  const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
    env: {
      ...process.env,
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

const LANGS = ["en", "zh"];
const UI = {
  en: { run: "Run", settings: "Settings", archived: "Archived chats", completed: "completed" },
  zh: { run: "运行", settings: "设置", archived: "已归档对话", completed: "completed" },
};

async function shots() {
  const { chromium } = await import("@playwright/test");
  mkdirSync(OUT_DIR, { recursive: true });
  const cookie = await login(ADMIN_PASSWORD);
  const projectId = (await api(cookie, "GET", "/api/projects")).json.projects[0].projectId;
  const browser = await chromium.launch({
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      ...(process.env.SHOT_FONTCONFIG ? { FONTCONFIG_FILE: process.env.SHOT_FONTCONFIG } : {}),
    },
  });
  const pages = [];

  async function openPage(lang, url, viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: lang === "zh" ? "zh-CN" : "en-US",
      timezoneId: "Asia/Shanghai",
    });
    await context.addInitScript(
      ([l, p]) => {
        localStorage.setItem("penguin.lang", l);
        localStorage.setItem("penguin.themeId", "modern");
        localStorage.setItem("penguin.theme", "light");
        localStorage.setItem("penguin.lastProjectId", p);
        localStorage.setItem("penguin.dock.launcherHidden", "1");
      },
      [lang, projectId],
    );
    const page = await context.newPage();
    pages.push({ lang, page });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const res = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: "admin", password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
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

  const T = {
    en: {
      enable: "Enable API access",
      keylessHint:
        "Anything that can reach this address can talk to the agent; recommended for loopback use only.",
      tryIt: "Try it",
      example: "What time is it now?",
      run: "Run",
    },
    zh: {
      enable: "开启 API 访问",
      keylessHint: "任何能访问此地址的程序都能与该 Agent 对话；仅建议本机使用。",
      tryIt: "试一试",
      example: "现在几点了？",
      run: "运行",
    },
  };
  try {
    for (const lang of LANGS) {
      const t = T[lang];
      const page = await openPage(lang, `/agents/${AGENT}?tab=api`, { width: 1280, height: 1500 });
      const enable = page.getByText(t.enable, { exact: true }).first();
      await enable.waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);

      // The switch, the approval mode, the connection and the keys.
      if (stage("tab")) {
        // From the switch's card down to the keyless hint, across the tab's column.
        const top = await enable.boundingBox();
        const hint = await page.getByText(t.keylessHint, { exact: true }).first().boundingBox();
        const column = await page.locator("main").first().boundingBox();
        const examples = await page.locator("pre").first().boundingBox();
        await page.mouse.move(5, 5);
        const x = examples.x - 24;
        await save(page, `agent-api-tab-${lang}.png`, {
          x,
          y: top.y - 30,
          width: Math.min(column.x + column.width, examples.x + examples.width + 24) - x,
          height: hint.y + hint.height + 24 - (top.y - 30),
        });
      }

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
        await page.waitForTimeout(1000);
        await panel.scrollIntoViewIfNeeded();
        const clip = await clipAround(page, [panel], 16);
        await save(page, `agent-api-try-${lang}.png`, clip);
        await save(page, `penguinharness-0-2-14-agent-api-${lang}.png`, clip);
      }
      await debug(page, `tab-${lang}`);
    }
  } catch (err) {
    for (const { lang, page } of pages) await debug(page, `fail-${lang}`);
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
