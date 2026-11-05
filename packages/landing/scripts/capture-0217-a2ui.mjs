/**
 * Capture the 0.2.17 release-post screenshots of A2UI replies: one reply carrying a chart (a
 * grouped bar chart with units on the axis) and a machine's resource board, and one carrying a
 * form, answered through the page and then shown read-only after a reload. Each is shot once per
 * UI language, with the conversation in that language too:
 *
 *   penguinharness-0-2-17-a2ui-charts-{en,zh}.png
 *   penguinharness-0-2-17-a2ui-form-{en,zh}.png
 *
 * Same machinery as capture-0214-a2ui.mjs: a scripted mock LLM speaking OpenAI chat-completions
 * SSE, the built server on a scratch data root, Playwright Chromium. The mock sends each reply
 * exactly as the a2ui skill would (validated with plugins/a2ui/skills/a2ui/scripts/check.mjs:
 * `--dump <dir>` writes the replies as Markdown for that), and the script asserts that every
 * block rendered as a component: no invalid-block fallback, no raw fence text, every expected
 * `data-a2ui` type on screen.
 *
 * The form is answered the way a reader answers it: a pick, two chips, the number stepped up,
 * the rest left at the model's defaults, then the fill button and Send. The reply that follows
 * makes the form an older turn, so after the reload it is drawn read-only from the answer.
 *
 * The clock: with SHOT_FAKETIME_LIB pointing at libfaketime.so.1, the server is started with its
 * clock moved to SHOT_NOW (default the release morning) and the page clock is pinned to the same
 * moment, so the replies' `asOf` times and the conversation's own times agree.
 *
 * Output: $SHOT_SCRATCH/out (default packages/landing/.blog-assets/, gitignored). The PNGs are
 * quantized afterwards and hosted in the community repo's blog-assets/.
 *
 * Prereqs: a built tree (`pnpm -r build`) and Playwright's chromium. Run from the repo:
 *   node packages/landing/scripts/capture-0217-a2ui.mjs [--dump <dir>]
 * Env: SHOT_SCRATCH, SHOT_SRV_PORT (19215), SHOT_MOCK_PORT (19216), SHOT_FONTCONFIG,
 * SHOT_FAKETIME_LIB, SHOT_NOW, SHOT_SCENES (charts,form), SHOT_LANGS (en,zh), and for review only
 * SHOT_DARK=1 (dark theme) and SHOT_HOVER=1 (a chart bar hovered; the form's open state, before
 * its answer is sent).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SCRATCH = process.env.SHOT_SCRATCH ?? path.resolve(HERE, "../.blog-assets/a2ui-0217");
const OUT_DIR = process.env.SHOT_SCRATCH
  ? path.join(SCRATCH, "out")
  : path.resolve(HERE, "../.blog-assets");
const SRV_PORT = Number(process.env.SHOT_SRV_PORT ?? 19215);
const MOCK_PORT = Number(process.env.SHOT_MOCK_PORT ?? 19216);
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-shots-0217";
// The App is served on `localhost`; 127.0.0.1 is the Workspace-preview host and answers 401.
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const NOW = new Date(process.env.SHOT_NOW ?? "2026-10-26T10:30:00+08:00");
const DARK = process.env.SHOT_DARK === "1";
const HOVER = process.env.SHOT_HOVER === "1";
const SUFFIX = `${DARK ? "-dark" : ""}${HOVER ? "-hover" : ""}`;

// ---------------------------------------------------------------------------
// Replies. Built from objects so the JSON in each fence is exactly what the grammar reads.
// ---------------------------------------------------------------------------

const a2ui = (block) => ["```a2ui", JSON.stringify(block, null, 2), "```"].join("\n");
const reply = (...parts) => parts.join("\n\n");

/** build-01 as `scripts/sysinfo.mjs` would print it; the same readings in both languages. */
const RESOURCES = {
  type: "resources",
  host: "build-01",
  cpu: { percent: 34, history: [18, 26, 41, 37, 30, 34], cores: 16 },
  memory: { used: 22.1, total: 32, unit: "GB", history: [61, 64, 70, 69, 68, 69] },
  swap: { used: 0.4, total: 8, unit: "GB" },
  disks: [
    { path: "/", used: 142, total: 500, unit: "GB" },
    { path: "/data", used: 1.3, total: 2, unit: "TB" },
  ],
  network: {
    unit: "MB/s",
    rx: [4.2, 6.8, 5.1, 12.4, 9.7, 6.3, 5.8, 7.1],
    tx: [1.1, 1.9, 1.4, 3.6, 2.8, 1.7, 1.5, 2.0],
  },
  load: { one: 3.1, five: 2.8, fifteen: 2.4, cores: 16 },
  asOf: "2026-10-26T10:24+08:00",
};

/** Last week's CI build times, in minutes; the same numbers in both languages. */
const BUILD_MINUTES = {
  main: [11.8, 12.1, 20.4, 12.5, 11.9],
  release: [15.2, 15.6, 24.9, 15.1, 15.4],
};

const CHARTS = {
  en: {
    prompt:
      "Compare last week's CI build times for main and release/0.2.17, and check whether build-01 can take tonight's release build.",
    title: "build-01 before the release build",
    reply: reply(
      "Both branches built slower last Wednesday, when the dependency cache was cold. The release branch runs the full test matrix, so it took longer than main every day.",
      a2ui({
        type: "chart",
        kind: "bar",
        title: "CI build time, last week",
        categories: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        series: [
          { label: "main", values: BUILD_MINUTES.main },
          { label: "release/0.2.17", values: BUILD_MINUTES.release },
        ],
        yLabel: "Build time",
        yUnit: "min",
      }),
      "build-01 can take tonight's build: no reading is near its warning mark.",
      a2ui(RESOURCES),
      "Start the release build when you are ready.",
    ),
    expect: ["chart", "resources"],
  },
  zh: {
    prompt:
      "对比一下上周 main 和 release/0.2.17 的 CI 构建耗时，再看看 build-01 能不能跑今晚的发布构建。",
    title: "发布构建前检查 build-01",
    reply: reply(
      "上周三依赖缓存失效，两个分支的构建都变慢了。release 分支每次都跑完整的测试矩阵，所以每天都比 main 慢。",
      a2ui({
        type: "chart",
        kind: "bar",
        title: "上周 CI 构建耗时",
        categories: ["周一", "周二", "周三", "周四", "周五"],
        series: [
          { label: "main", values: BUILD_MINUTES.main },
          { label: "release/0.2.17", values: BUILD_MINUTES.release },
        ],
        yLabel: "构建耗时",
        yUnit: "分钟",
      }),
      "build-01 的各项读数都离警戒线很远，可以跑今晚的构建。",
      a2ui(RESOURCES),
      "准备好了就开始发布构建。",
    ),
    expect: ["chart", "resources"],
  },
};

const FORM = {
  en: {
    prompt: "Set up a nightly evaluation of the support agent.",
    title: "Nightly evaluation of the support agent",
    reply: reply(
      "I can schedule the nightly evaluation once I know what it should cover and when it should start.",
      a2ui({
        type: "form",
        title: "Nightly evaluation",
        fields: [
          {
            id: "suite",
            label: "Benchmark",
            kind: "single",
            options: [{ label: "Tickets" }, { label: "Refunds" }, { label: "Escalations" }],
            required: true,
          },
          {
            id: "checks",
            label: "What to grade",
            kind: "multiple",
            options: [
              { label: "Accuracy" },
              { label: "Tone" },
              { label: "Policy citations" },
              { label: "Response time" },
            ],
            required: true,
          },
          {
            id: "cases",
            label: "Cases per run",
            kind: "number",
            min: 10,
            max: 200,
            step: 10,
            unit: "cases",
            default: 50,
          },
          {
            id: "temperature",
            label: "Temperature",
            kind: "slider",
            min: 0,
            max: 1,
            step: 0.1,
            default: 0.2,
          },
          { id: "start", label: "First run", kind: "date", default: "2026-10-27" },
          { id: "notify", label: "Notify me when it ends", kind: "switch", default: true },
        ],
        submitLabel: "Schedule",
      }),
    ),
    /** What the reader does: the option and chips clicked, and how many times + is pressed. */
    answer: { pick: "Tickets", chips: ["Accuracy", "Policy citations"], stepUp: 2 },
    /** The line the filled composer must hold once the answers are in. */
    fillProbe: "Cases per run: 70 cases",
    ack: "Got it: the Tickets benchmark, graded for accuracy and policy citations, 70 cases a night from October 27, with a notice when each run ends. I'll create the schedule next.",
    expect: ["form"],
  },
  zh: {
    prompt: "给客服 Agent 设一个每晚的评测。",
    title: "客服 Agent 夜间评测",
    reply: reply(
      "告诉我评测的范围和开始时间，我就把每晚的评测排上。",
      a2ui({
        type: "form",
        title: "夜间评测",
        fields: [
          {
            id: "suite",
            label: "评测集",
            kind: "single",
            options: [{ label: "工单" }, { label: "退款" }, { label: "升级处理" }],
            required: true,
          },
          {
            id: "checks",
            label: "评分项",
            kind: "multiple",
            options: [
              { label: "准确性" },
              { label: "语气" },
              { label: "政策引用" },
              { label: "响应时间" },
            ],
            required: true,
          },
          {
            id: "cases",
            label: "每次用例数",
            kind: "number",
            min: 10,
            max: 200,
            step: 10,
            unit: "条",
            default: 50,
          },
          {
            id: "temperature",
            label: "温度",
            kind: "slider",
            min: 0,
            max: 1,
            step: 0.1,
            default: 0.2,
          },
          { id: "start", label: "首次运行", kind: "date", default: "2026-10-27" },
          { id: "notify", label: "结束时通知我", kind: "switch", default: true },
        ],
        submitLabel: "安排评测",
      }),
    ),
    answer: { pick: "工单", chips: ["准确性", "政策引用"], stepUp: 2 },
    fillProbe: "每次用例数：70 条",
    ack: "好的：评测集用「工单」，按准确性和政策引用评分，从 10 月 27 日起每晚 70 个用例，每次结束时通知你。接下来我来创建排期。",
    expect: ["form"],
  },
};

const SCENES = [
  { key: "charts", data: CHARTS },
  { key: "form", data: FORM },
].filter((s) => (process.env.SHOT_SCENES ?? "charts,form").split(",").includes(s.key));
const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");

// `--dump <dir>`: write the replies as Markdown (for the checker) and exit.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The scene whose prompt appears in the request, or null. */
function sceneOf(flat) {
  for (const { data } of SCENES) {
    for (const lang of ["en", "zh"]) if (flat.includes(data[lang].prompt)) return data[lang];
  }
  return null;
}

async function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
  const scene = sceneOf(flat);
  const isTitle = flat.includes("You are a title generator.");
  const users = messages.filter((m) => m.role === "user").length;
  // The form's answer is the second user message; the reply to it acknowledges the answers.
  const text = isTitle
    ? (scene?.title ?? "Conversation")
    : scene?.ack !== undefined && users >= 2
      ? scene.ack
      : (scene?.reply ?? "OK.");

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-shot",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  chunk({ role: "assistant" });
  if (!isTitle) await sleep(600);
  for (const piece of text.match(/[\s\S]{1,48}/g) ?? []) {
    chunk({ content: piece });
    if (!isTitle) await sleep(15);
  }
  chunk({}, "stop", {
    prompt_tokens: 9200,
    completion_tokens: isTitle ? 8 : 640,
    total_tokens: isTitle ? 9208 : 9840,
    prompt_cache_hit_tokens: 8700,
    prompt_cache_miss_tokens: 500,
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
      if (req.url?.includes("chat/completions")) return void openaiReply(res, json);
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
    await sleep(500);
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

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const { chromium } = await import("@playwright/test");
const dataRoot = path.join(SCRATCH, "data");
rmSync(dataRoot, { recursive: true, force: true });
const workspace = path.join(dataRoot, "workspaces", "release-checks");
mkdirSync(workspace, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[a2ui] mock LLM on ${MOCK}`);

const offset = Math.round((NOW.getTime() - Date.now()) / 1000);
const clockEnv = fakeClockEnv(offset);
const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    ...clockEnv,
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

  // Rotate the seeded password, or a banner covers the top of every shot. The admin is seeded a
  // moment after the server starts answering.
  let cookie = null;
  for (let i = 0; i < 60 && cookie === null; i++) {
    const seeded = await login(SEED_PASSWORD).catch(() => null);
    if (seeded !== null) {
      await api(seeded, "PUT", "/api/me/password", {
        oldPassword: SEED_PASSWORD,
        newPassword: ADMIN_PASSWORD,
      });
      cookie = await login(ADMIN_PASSWORD);
      break;
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

  const browser = await chromium.launch({
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      ...(process.env.SHOT_FONTCONFIG ? { FONTCONFIG_FILE: process.env.SHOT_FONTCONFIG } : {}),
    },
  });

  for (const lang of LANGS) {
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
        viewport: { width: 1440, height: key === "charts" ? 2400 : 1700 },
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
      lastPage = page;
      if (clockEnv.FAKETIME)
        await page.clock.install({ time: new Date(Date.now() + offset * 1000) });
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const res = await page.request.post(`${BASE}/api/auth/login`, {
        data: { userId: "admin", password: ADMIN_PASSWORD },
      });
      if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);

      const open = async () => {
        await page.goto(`${BASE}/chat/${sessionId}`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        for (const type of scene.expect) {
          await page.locator(`[data-a2ui="${type}"]`).first().waitFor({ timeout: 60000 });
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
        // Let the reveal and the charts' draw-in finish.
        await page.waitForTimeout(3000);
      };
      await open();

      if (key === "form") {
        const form = page.locator('[data-a2ui="form"]').first();
        if (HOVER) {
          // The open question, for review: the reader's answers in, not yet sent.
          await answerForm(page, form, scene.answer);
          await page.mouse.move(5, 5);
          await shoot(
            page,
            scene,
            key,
            lang,
            `penguinharness-0-2-17-a2ui-form-${lang}${SUFFIX}-open.png`,
          );
        } else {
          await answerForm(page, form, scene.answer);
        }
        await form.getByRole("button", { name: form_submit(scene) }).click();
        const composer = page.locator("textarea").first();
        await page.waitForFunction(
          ([probe]) =>
            [...document.querySelectorAll("textarea")].some((t) => t.value.includes(probe)),
          [scene.fillProbe],
          { timeout: 10000 },
        );
        await composer.press("Enter");
        await page
          .getByText(scene.ack.slice(0, 24), { exact: false })
          .first()
          .waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);
        // The reload: the form is an older turn now, drawn from the answer that followed it.
        await open();
        const answered = page.locator('[data-a2ui="form"]').first();
        if (await answered.getByRole("button", { name: form_submit(scene) }).count()) {
          throw new Error(`form-${lang}: still interactive after the reload`);
        }
      }

      const problems = await page.evaluate(() => {
        const out = [];
        if (document.querySelector('[data-a2ui="invalid"]')) out.push("invalid block fallback");
        for (const el of document.querySelectorAll("pre, code")) {
          const t = el.textContent ?? "";
          if (t.includes("```a2ui") || t.includes('"type":')) {
            if (el.getClientRects().length > 0) out.push(`raw fence text: ${t.slice(0, 60)}`);
          }
        }
        return out;
      });
      if (problems.length > 0) throw new Error(`${key}-${lang}: ${problems.join("; ")}`);

      if (HOVER && key === "charts") {
        // A bar answers the pointer: hover Wednesday's release bar.
        const chart = page.locator('[data-a2ui="chart"]').first();
        const box = await chart.boundingBox();
        await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.45);
        await page.waitForTimeout(800);
      } else {
        await page.mouse.move(5, 5);
      }
      await shoot(page, scene, key, lang, `penguinharness-0-2-17-a2ui-${key}-${lang}${SUFFIX}.png`);
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
      const dump = path.join(SCRATCH, "debug");
      mkdirSync(dump, { recursive: true });
      writeFileSync(
        path.join(dump, "a2ui-failure.png"),
        await lastPage.screenshot({ fullPage: true }),
      );
      writeFileSync(
        path.join(dump, "a2ui-failure.txt"),
        await lastPage.evaluate(() => document.body.innerText),
      );
    }
  } catch {}
  process.exit(1);
}

/** The form's fill button, by the label the reply gave it. */
function form_submit(scene) {
  const label = /"submitLabel": "([^"]+)"/.exec(scene.reply)?.[1];
  return new RegExp(`^${label}$`);
}

/** Answer the form as a reader does: pick an option, toggle chips, step the number up. */
async function answerForm(page, form, answer) {
  // Segments and chips are toggle buttons (`aria-pressed`).
  await form.getByRole("button", { name: answer.pick, exact: true }).first().click();
  for (const chip of answer.chips) {
    await form.getByRole("button", { name: chip, exact: true }).first().click();
  }
  const stepUp = form.getByRole("button", { name: /^(Increase|增加)$/ }).first();
  for (let i = 0; i < answer.stepUp; i++) await stepUp.click();
  await page.waitForTimeout(400);
}

/**
 * Crop: the user's prompt down to the last thing in the reply that the scene shows, across the
 * reply column. For the form that is the form block; for the charts, the closing sentence.
 */
async function shoot(page, scene, key, lang, file) {
  const promptBox = await page.getByText(scene.prompt, { exact: true }).first().boundingBox();
  const blocks = page.locator("[data-a2ui]");
  const firstBox = await blocks.first().boundingBox();
  let bottom;
  if (key === "charts") {
    const closing = scene.reply.split("\n\n").at(-1);
    const closingBox = await page.getByText(closing, { exact: true }).first().boundingBox();
    bottom = closingBox.y + closingBox.height;
  } else {
    const formBox = await page.locator('[data-a2ui="form"]').first().boundingBox();
    bottom = formBox.y + formBox.height;
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
  await page.screenshot({ path: path.join(OUT_DIR, file), clip });
  writeFileSync(
    path.join(OUT_DIR, file.replace(/\.png$/, ".txt")),
    await page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText),
  );
  console.log(`[a2ui] ${file} ${JSON.stringify(clip)}`);
}
