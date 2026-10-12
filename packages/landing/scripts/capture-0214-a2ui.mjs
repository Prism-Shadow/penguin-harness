/**
 * Capture the 0.2.14 release-post screenshots of A2UI replies: one reply carrying blocks (a
 * Mermaid flow, a steps procedure and a choice) and one carrying the four widgets (weather,
 * clock, countdown, metrics). Each is shot once per UI language, with the conversation in that
 * language too:
 *
 *   penguinharness-0-2-14-a2ui-blocks-{en,zh}.png
 *   penguinharness-0-2-14-a2ui-widgets-{en,zh}.png
 *
 * Same machinery as capture-blog-013-shots.mjs: a scripted mock LLM speaking OpenAI
 * chat-completions SSE, the built server on a scratch data root, Playwright Chromium. The mock
 * sends each reply exactly as the a2ui skill would (validated with
 * plugins/a2ui/skills/a2ui/scripts/check.mjs: `--dump <dir>` writes the four replies as
 * Markdown for that), and the script asserts that every block rendered as a component: no
 * invalid-block fallback, no raw fence text, every expected `data-a2ui` type on screen.
 *
 * The page clock is pinned (Asia/Shanghai, 2026-10-12 15:30) so the live clock and countdown
 * read sensibly against the fixed `asOf` times in the widgets.
 *
 * Output: packages/landing/.blog-assets/ (gitignored). The PNGs are quantized afterwards and
 * hosted in the community repo's blog-assets/.
 *
 * Prereqs: a built tree (`pnpm -r build`) and Playwright's chromium. Run from the repo:
 *   node packages/landing/scripts/capture-0214-a2ui.mjs [--dump <dir>]
 * Env: SHOT_DATA_DIR (scratch parent, default the OS temp dir), SHOT_SRV_PORT (19115),
 * SHOT_MOCK_PORT (19116), SHOT_FONTCONFIG (a fonts.conf for Chromium).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT_DIR = path.resolve(HERE, "../.blog-assets");
const SRV_PORT = Number(process.env.SHOT_SRV_PORT ?? 19115);
const MOCK_PORT = Number(process.env.SHOT_MOCK_PORT ?? 19116);
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-shots-0214";
// The App is served on `localhost`; 127.0.0.1 is the Workspace-preview host and answers 401.
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const PINNED_NOW = new Date("2026-10-12T15:30:00+08:00");

// ---------------------------------------------------------------------------
// Replies. Built from objects so the JSON in each fence is exactly what the grammar reads.
// ---------------------------------------------------------------------------

const a2ui = (block) => ["```a2ui", JSON.stringify(block, null, 2), "```"].join("\n");
const mermaid = (lines) => ["```mermaid", ...lines, "```"].join("\n");
const reply = (...parts) => parts.join("\n\n");

const BLOCKS = {
  en: {
    prompt: "We ship v2.4 of the billing service on Thursday. Walk me through the rollout.",
    title: "Billing v2.4 rollout",
    reply: reply(
      "The rollout has four stages, and each stage gates the next one.",
      mermaid([
        "flowchart LR",
        "  A[Build v2.4] --> B[Staging]",
        "  B --> C{Checks pass?}",
        "  C -- no --> A",
        "  C -- yes --> D[Canary]",
        "  D -- errors rise --> F[Roll back]",
        "  D -- stable for 2 h --> E[Full rollout]",
      ]),
      "Before the canary starts, prepare the database in three steps.",
      a2ui({
        type: "steps",
        title: "Prepare the billing database",
        steps: [
          {
            text: "Take a snapshot of the billing database.",
            code: "pg_dump billing > billing-pre-v2.4.sql",
            lang: "sh",
          },
          {
            caution: "The migration locks the invoices table for about 1 minute.",
            text: "Run the schema migration outside peak hours.",
            code: "pnpm db:migrate",
            lang: "sh",
          },
          {
            text: "Run the smoke tests on staging.",
            note: "The smoke suite takes about 4 minutes.",
          },
        ],
      }),
      "The canary size decides how fast you get a signal and how many customers see a bad build.",
      a2ui({
        type: "choice",
        question: "How much traffic should the canary take first?",
        options: [
          {
            label: "5%",
            value: "Start the canary at 5% of traffic",
            description: "Few customers see errors; you need about 2 hours of data.",
            recommended: true,
          },
          {
            label: "25%",
            value: "Start the canary at 25% of traffic",
            description: "A faster signal, with more customers exposed.",
          },
          {
            label: "Skip the canary",
            value: "Skip the canary and roll out to everyone",
            description: "Only if staging matches production exactly.",
          },
        ],
        allowOther: true,
      }),
    ),
    expect: ["mermaid", "steps", "choice"],
  },
  zh: {
    prompt: "计费服务 v2.4 周四上线，帮我把上线流程理一下。",
    title: "计费服务 v2.4 上线",
    reply: reply(
      "上线分四个阶段，每个阶段通过后才进入下一个。",
      mermaid([
        "flowchart LR",
        "  A[构建 v2.4] --> B[预发环境]",
        "  B --> C{检查通过？}",
        "  C -- 否 --> A",
        "  C -- 是 --> D[灰度]",
        "  D -- 错误率上升 --> F[回滚]",
        "  D -- 稳定 2 小时 --> E[全量发布]",
      ]),
      "灰度开始前，按下面三步准备数据库。",
      a2ui({
        type: "steps",
        title: "准备计费数据库",
        steps: [
          {
            text: "给计费数据库做一份快照。",
            code: "pg_dump billing > billing-pre-v2.4.sql",
            lang: "sh",
          },
          {
            caution: "迁移会锁住 invoices 表约 1 分钟。",
            text: "在业务低峰时执行表结构迁移。",
            code: "pnpm db:migrate",
            lang: "sh",
          },
          { text: "在预发环境跑一遍冒烟测试。", note: "冒烟测试约需 4 分钟。" },
        ],
      }),
      "灰度比例决定了多快能看到信号，也决定了出问题时影响多少客户。",
      a2ui({
        type: "choice",
        question: "灰度第一步放多少流量？",
        options: [
          {
            label: "5%",
            value: "灰度先放 5% 流量",
            description: "出错时影响的客户少，约需 2 小时的数据。",
            recommended: true,
          },
          {
            label: "25%",
            value: "灰度先放 25% 流量",
            description: "信号来得更快，受影响的客户也更多。",
          },
          {
            label: "跳过灰度",
            value: "跳过灰度，直接全量发布",
            description: "仅当预发与生产环境完全一致时。",
          },
        ],
        allowOther: true,
      }),
    ),
    expect: ["mermaid", "steps", "choice"],
  },
};

/** The weather block, per language (place, wind direction); readings shared. */
function weather(lang) {
  return {
    type: "weather",
    place: lang === "zh" ? "北京" : "Beijing",
    condition: "partly-cloudy",
    temp: 19,
    unit: "C",
    high: 22,
    low: 12,
    feelsLike: 18,
    humidity: 58,
    windSpeed: 11,
    windUnit: "km/h",
    windDirection: lang === "zh" ? "东北" : "NE",
    hourly: [
      { time: "16:00", temp: 19, condition: "partly-cloudy", precip: 10 },
      { time: "17:00", temp: 18, condition: "partly-cloudy", precip: 10 },
      { time: "18:00", temp: 16, condition: "cloudy", precip: 20, night: true },
      { time: "19:00", temp: 15, condition: "cloudy", precip: 20, night: true },
      { time: "20:00", temp: 14, condition: "cloudy", precip: 30, night: true },
      { time: "21:00", temp: 13, condition: "drizzle", precip: 40, night: true },
    ],
    daily: [
      { date: "2026-10-12", high: 22, low: 12, condition: "partly-cloudy", precip: 20 },
      { date: "2026-10-13", high: 20, low: 11, condition: "cloudy", precip: 30 },
      { date: "2026-10-14", high: 17, low: 10, condition: "rain", precip: 80 },
    ],
    asOf: "2026-10-12T15:25+08:00",
    source: "Open-Meteo",
  };
}

const WIDGETS = {
  en: {
    prompt:
      "Release status board, please: Beijing weather, the team's clocks, time left to the release, and how build-01 is doing.",
    title: "Release status board",
    reply: reply(
      "Beijing is partly cloudy at 19°C, and rain is likely on Wednesday.",
      a2ui(weather("en")),
      "The team works across three time zones.",
      a2ui({
        type: "clock",
        zones: [
          { zone: "Asia/Shanghai", label: "Beijing" },
          { zone: "Europe/London", label: "London" },
          { zone: "America/Los_Angeles", label: "San Francisco" },
        ],
        hourCycle: "24",
      }),
      "The release goes out on Thursday at 20:00 Beijing time.",
      a2ui({
        type: "countdown",
        to: "2026-10-15T20:00+08:00",
        label: "v2.4 release",
        doneLabel: "v2.4 is live",
      }),
      "The build machine is healthy, but its disk needs attention before the release.",
      a2ui({
        type: "metrics",
        title: "build-01",
        items: [
          {
            label: "CPU",
            value: 42,
            max: 100,
            unit: "%",
            warn: 80,
            danger: 95,
            history: [28, 35, 51, 47, 39, 44, 42],
          },
          {
            label: "Memory",
            kind: "used",
            value: 21.4,
            max: 32,
            unit: "GB",
            decimals: 1,
            warn: 27,
            danger: 30,
            delta: 1.2,
            deltaLabel: "vs. yesterday",
          },
          { label: "Disk", kind: "used", value: 431, max: 500, unit: "GB", warn: 400, danger: 475 },
          {
            label: "Release checklist",
            kind: "progress",
            value: 9,
            max: 12,
            detail: "9 of 12 tasks done",
          },
        ],
        asOf: "2026-10-12T15:28+08:00",
      }),
      "Clear old build caches on build-01 before Thursday.",
    ),
    expect: ["weather", "clock", "countdown", "metrics"],
  },
  zh: {
    prompt:
      "给我一个发布前的状态看板：北京天气、团队各地时间、距离发布还有多久，还有 build-01 的状况。",
    title: "发布状态看板",
    reply: reply(
      "北京现在多云，19°C，周三大概率有雨。",
      a2ui(weather("zh")),
      "团队分布在三个时区。",
      a2ui({
        type: "clock",
        zones: [
          { zone: "Asia/Shanghai", label: "北京" },
          { zone: "Europe/London", label: "伦敦" },
          { zone: "America/Los_Angeles", label: "旧金山" },
        ],
        hourCycle: "24",
      }),
      "版本在周四北京时间 20:00 发布。",
      a2ui({
        type: "countdown",
        to: "2026-10-15T20:00+08:00",
        label: "v2.4 发布",
        doneLabel: "v2.4 已上线",
      }),
      "构建机运行正常，但发布前要先处理磁盘空间。",
      a2ui({
        type: "metrics",
        title: "build-01",
        items: [
          {
            label: "CPU",
            value: 42,
            max: 100,
            unit: "%",
            warn: 80,
            danger: 95,
            history: [28, 35, 51, 47, 39, 44, 42],
          },
          {
            label: "内存",
            kind: "used",
            value: 21.4,
            max: 32,
            unit: "GB",
            decimals: 1,
            warn: 27,
            danger: 30,
            delta: 1.2,
            deltaLabel: "较昨天",
          },
          { label: "磁盘", kind: "used", value: 431, max: 500, unit: "GB", warn: 400, danger: 475 },
          { label: "发布清单", kind: "progress", value: 9, max: 12, detail: "12 项已完成 9 项" },
        ],
        asOf: "2026-10-12T15:28+08:00",
      }),
      "周四前清理一下 build-01 上的旧构建缓存。",
    ),
    expect: ["weather", "clock", "countdown", "metrics"],
  },
};

const SCENES = [
  { key: "blocks", data: BLOCKS },
  { key: "widgets", data: WIDGETS },
];

// `--dump <dir>`: write the four replies as Markdown (for the checker) and exit.
const dumpAt = process.argv.indexOf("--dump");
if (dumpAt !== -1) {
  const dir = path.resolve(process.argv[dumpAt + 1] ?? ".");
  mkdirSync(dir, { recursive: true });
  for (const { key, data } of SCENES) {
    for (const lang of ["en", "zh"]) {
      writeFileSync(path.join(dir, `${key}-${lang}.md`), `${data[lang].reply}\n`);
    }
  }
  console.log(`[a2ui] replies written to ${dir}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Mock LLM (OpenAI chat-completions SSE).
// ---------------------------------------------------------------------------

/** The scene whose prompt appears in the request, or null. */
function sceneOf(flat) {
  for (const { data } of SCENES) {
    for (const lang of ["en", "zh"]) if (flat.includes(data[lang].prompt)) return data[lang];
  }
  return null;
}

function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
  const scene = sceneOf(flat);
  const isTitle = flat.includes("You are a title generator.");
  const text = isTitle ? (scene?.title ?? "Conversation") : (scene?.reply ?? "OK.");

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-shot",
      object: "chat.completion.chunk",
      created: Math.floor(PINNED_NOW.getTime() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  chunk({ role: "assistant" });
  for (const piece of text.match(/[\s\S]{1,48}/g) ?? []) chunk({ content: piece });
  chunk({}, "stop", {
    prompt_tokens: 3200,
    completion_tokens: isTitle ? 8 : 640,
    total_tokens: isTitle ? 3208 : 3840,
    prompt_cache_hit_tokens: 2800,
    prompt_cache_miss_tokens: 400,
  });
  res.write("data: [DONE]\n\n");
  res.end();
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
      console.log(`[mock] unexpected path ${req.url}`);
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
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
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

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const { chromium } = await import("@playwright/test");
const scratchParent = process.env.SHOT_DATA_DIR ?? os.tmpdir();
mkdirSync(scratchParent, { recursive: true });
const dataRoot = mkdtempSync(path.join(scratchParent, "run-"));
const workspace = path.join(dataRoot, "billing-service");
mkdirSync(workspace, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[a2ui] mock LLM on ${MOCK}`);

const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    PENGUIN_HOME: path.join(dataRoot, "home"),
    PENGUIN_WEB_DB: path.join(dataRoot, "home", "web.db"),
    PENGUIN_WEB_DIST: path.join(ROOT, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
    PENGUIN_SEED_ADMIN_PASSWORD: SEED_PASSWORD,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
const cleanup = () => {
  try {
    srv.kill();
  } catch {}
  try {
    mock.close();
  } catch {}
};
process.on("exit", cleanup);

let lastPage = null;
try {
  await waitFor(`${BASE}/`);
  console.log(`[a2ui] server ready on ${BASE}`);

  // Rotate the seeded password, or a banner covers the top of every shot.
  let cookie = await login(SEED_PASSWORD);
  await api(cookie, "PUT", "/api/me/password", {
    oldPassword: SEED_PASSWORD,
    newPassword: ADMIN_PASSWORD,
  });
  cookie = await login(ADMIN_PASSWORD);

  let projectId = (await api(cookie, "GET", "/api/projects")).json.projects?.[0]?.projectId;
  if (!projectId) {
    projectId = "demo";
    await api(cookie, "POST", "/api/projects", { projectId, name: "Demo" });
  }
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

  const browser = await chromium.launch({
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      ...(process.env.SHOT_FONTCONFIG ? { FONTCONFIG_FILE: process.env.SHOT_FONTCONFIG } : {}),
    },
  });

  for (const lang of ["en", "zh"]) {
    for (const { key, data } of SCENES) {
      const scene = data[lang];
      const sessionId = (
        await api(cookie, "POST", `/api/projects/${projectId}/agents/default_agent/sessions`, {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          approvalMode: "allow-all",
          workspace,
        })
      ).json.session.sessionId;
      await api(cookie, "POST", `/api/sessions/${sessionId}/tasks`, {
        input: [{ type: "text", text: scene.prompt }],
      });

      const context = await browser.newContext({
        viewport: { width: 1440, height: key === "widgets" ? 2000 : 1500 },
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
        },
        [lang, projectId],
      );
      const page = await context.newPage();
      lastPage = page;
      await page.clock.install({ time: PINNED_NOW });
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const res = await page.request.post(`${BASE}/api/auth/login`, {
        data: { userId: "admin", password: ADMIN_PASSWORD },
      });
      if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
      await page.goto(`${BASE}/chat/${sessionId}`, { waitUntil: "domcontentloaded" });

      // Every expected block drawn as its component (mermaid: once its SVG exists).
      for (const type of scene.expect) {
        await page.locator(`[data-a2ui="${type}"]`).first().waitFor({ timeout: 60000 });
      }
      if (scene.expect.includes("mermaid")) {
        await page.locator('[data-a2ui="mermaid"] svg').first().waitFor({ timeout: 60000 });
      }
      // A credential or onboarding dialog would cover the reply.
      if (
        await page
          .getByRole("dialog")
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await page.keyboard.press("Escape");
      }
      // Let the reveal and the hourly line's draw-in finish.
      await page.waitForTimeout(3500);

      const problems = await page.evaluate(() => {
        const out = [];
        if (document.querySelector('[data-a2ui="invalid"]')) out.push("invalid block fallback");
        for (const el of document.querySelectorAll("pre, code")) {
          const t = el.textContent ?? "";
          if (t.includes("```a2ui") || t.includes('"type":') || t.includes("flowchart LR")) {
            if (el.getClientRects().length > 0) out.push(`raw fence text: ${t.slice(0, 60)}`);
          }
        }
        return out;
      });
      if (problems.length > 0) throw new Error(`${key}-${lang}: ${problems.join("; ")}`);

      // Crop: the user's prompt down to the last thing in the reply, across the reply column.
      const promptBox = await page.getByText(scene.prompt, { exact: true }).first().boundingBox();
      const blocks = page.locator("[data-a2ui]");
      const firstBox = await blocks.first().boundingBox();
      const lastBlock = await blocks.last().boundingBox();
      let bottom = lastBlock.y + lastBlock.height;
      if (key === "widgets") {
        const closing = scene.reply.split("\n\n").at(-1);
        const closingBox = await page.getByText(closing, { exact: true }).first().boundingBox();
        bottom = closingBox.y + closingBox.height;
      }
      const left = Math.min(firstBox.x, promptBox.x) - 32;
      const right = Math.max(firstBox.x + firstBox.width, promptBox.x + promptBox.width) + 32;
      const top = promptBox.y - 36;
      const clip = {
        x: Math.max(0, left),
        y: Math.max(0, top),
        width: right - Math.max(0, left),
        height: bottom + 28 - Math.max(0, top),
      };
      const file = `penguinharness-0-2-14-a2ui-${key}-${lang}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, file), clip });
      console.log(`[a2ui] ${file} ${JSON.stringify(clip)}`);
      await context.close();
    }
  }

  await browser.close();
  console.log(`[a2ui] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[a2ui] FAILED:", err);
  try {
    if (lastPage && !lastPage.isClosed()) {
      const dump = process.env.SHOT_DEBUG_DIR || os.tmpdir();
      writeFileSync(path.join(dump, "a2ui-failure.png"), await lastPage.screenshot());
      writeFileSync(
        path.join(dump, "a2ui-failure.txt"),
        await lastPage.evaluate(() => document.body.innerText),
      );
    }
  } catch {}
  process.exit(1);
}
