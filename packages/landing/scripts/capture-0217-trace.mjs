/**
 * Capture the 0.2.17 release-post screenshot of the rebuilt Trace view: a conversation's Trace
 * panel with its sticky toolbar (the rounds button naming the round in view), the summary, the
 * ruled round rows with their context rings, and the newest round open on its event rows, where
 * the thinking level the Session was switched to reads as text on the first `request_begin`.
 * The round navigator stays closed: open, it lies over the summary and leaves the ends of the
 * figures it covers showing beside it.
 *
 *   penguinharness-0-2-17-trace-{en,zh}.png
 *
 * The conversation is real apart from the model (a scripted mock speaking OpenAI chat-completions
 * SSE): three rounds in a small Node project. The agent reads a function, adds a check for it, and
 * in the third round runs the project's checks (the run exits 1 and stays an ordinary completed
 * tool call), fixes the function and runs them again. The Session's thinking level is switched
 * from medium to high before the third round, as a reader does from the composer.
 *
 * Paths: with SHOT_BIND_SRV=1 the server runs in a user and mount namespace with the scratch
 * directory bound on /srv, so the data root and the Workspace read /srv/… on every row and no home
 * directory can show. The clock: with SHOT_FAKETIME_LIB pointing at libfaketime.so.1 the server
 * (and every command it runs) is started with its clock moved to SHOT_NOW, and the page clock is
 * pinned to the same moment.
 *
 * Prereqs: a built tree (`pnpm -r build`) and Playwright's chromium. Run from the repo:
 *   node packages/landing/scripts/capture-0217-trace.mjs
 * Env: SHOT_SCRATCH (srv/, out/, debug/), SHOT_SRV_PORT (19217), SHOT_MOCK_PORT (19218),
 * SHOT_FONTCONFIG, SHOT_FAKETIME_LIB, SHOT_NOW, SHOT_BIND_SRV, SHOT_LANGS (en,zh), and for review
 * only SHOT_DARK=1 (dark theme), SHOT_HOVER=1 (the newest round's context ring opened on its
 * readings) and SHOT_NAV=1 (the round navigator open).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SCRATCH = process.env.SHOT_SCRATCH ?? path.resolve(HERE, "../.blog-assets/trace-0217");
const OUT_DIR = path.join(SCRATCH, "out");
const SRV_PORT = Number(process.env.SHOT_SRV_PORT ?? 19217);
const MOCK_PORT = Number(process.env.SHOT_MOCK_PORT ?? 19218);
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-shots-trace-0217";
// The App is served on `localhost`; 127.0.0.1 is the Workspace-preview host and answers 401.
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const NOW = new Date(process.env.SHOT_NOW ?? "2026-10-26T10:30:00+08:00");
const BIND_SRV = process.env.SHOT_BIND_SRV === "1";
const DARK = process.env.SHOT_DARK === "1";
const HOVER = process.env.SHOT_HOVER === "1";
const NAV = process.env.SHOT_NAV === "1";
const SUFFIX = `${DARK ? "-dark" : ""}${HOVER ? "-hover" : ""}${NAV ? "-nav" : ""}`;
const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");

// ---------------------------------------------------------------------------
// The project the agent works in: a total with a discount bug, and the project's own checks.
// ---------------------------------------------------------------------------

const TOTAL_JS = `/** The amount after a percentage discount. */
export function applyDiscount(amount, percent) {
  return amount - percent;
}

/** An invoice's total: every line's price times its quantity, less the discount. */
export function invoiceTotal(lines, percent = 0) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  return applyDiscount(subtotal, percent);
}
`;

/** The project's checks, in the language its developer writes them in. */
const CHECK_WORDS = {
  en: {
    cases: ["subtotal without a discount", "10% off 200"],
    ok: "`ok    ${name}`",
    fail: "`FAIL  ${name}: expected ${want}, got ${got}`",
    total: "`${cases.length - failed} passed, ${failed} failed`",
  },
  zh: {
    cases: ["无折扣小计", "200 打 9 折"],
    ok: "`通过  ${name}`",
    fail: "`失败  ${name}：应为 ${want}，实为 ${got}`",
    total: "`通过 ${cases.length - failed} 项，失败 ${failed} 项`",
  },
};
/** A failed check's line in the run's output, per language (case-sensitive, unlike a text filter). */
const FAIL_MARK = { en: /FAIL\s/, zh: /失败\s/ };

function checkScript(lang) {
  const w = CHECK_WORDS[lang];
  return [
    'import { applyDiscount, invoiceTotal } from "../src/total.js";',
    "",
    "const invoice = [",
    "  { price: 50, qty: 2 },",
    "  { price: 25, qty: 2 },",
    "  { price: 30, qty: 1 },",
    "];",
    "",
    "const cases = [",
    `  ["${w.cases[0]}", invoiceTotal(invoice), 180],`,
    `  ["${w.cases[1]}", applyDiscount(200, 10), 180],`,
    "];",
    "",
    "let failed = 0;",
    "for (const [name, got, want] of cases) {",
    "  if (got === want) {",
    `    console.log(${w.ok});`,
    "  } else {",
    "    failed += 1;",
    `    console.log(${w.fail});`,
    "  }",
    "}",
    `console.log(${w.total});`,
    "process.exitCode = failed > 0 ? 1 : 0;",
    "",
  ].join("\n");
}

const FIX = {
  old: "  return amount - percent;",
  new: "  return Math.round(amount * (100 - percent)) / 100;",
};
const NEW_CASE = {
  en: {
    old: '  ["10% off 200", applyDiscount(200, 10), 180],',
    new: '  ["10% off 200", applyDiscount(200, 10), 180],\n  ["10% off the invoice", invoiceTotal(invoice, 10), 162],',
  },
  zh: {
    old: '  ["200 打 9 折", applyDiscount(200, 10), 180],',
    new: '  ["200 打 9 折", applyDiscount(200, 10), 180],\n  ["整张发票打 9 折", invoiceTotal(invoice, 10), 162],',
  },
};
const RUN = "node scripts/check.mjs";

// ---------------------------------------------------------------------------
// The conversation, per language: each round's prompt and the agent's steps.
// ---------------------------------------------------------------------------

const ROUNDS = {
  en: [
    {
      prompt: "Read src/total.js and tell me what applyDiscount does.",
      steps: [
        {
          thinking: "Read the file before answering.",
          call: ["read_file", { file_path: "src/total.js" }],
        },
        {
          text: "`applyDiscount(amount, percent)` returns `amount - percent`, so it treats the percentage as an amount. `invoiceTotal` adds up price × quantity over the lines and passes the subtotal through it.",
        },
      ],
    },
    {
      prompt: "Add a check for 10% off the whole invoice to scripts/check.mjs.",
      steps: [
        {
          call: [
            "edit_file",
            {
              file_path: "scripts/check.mjs",
              old_string: NEW_CASE.en.old,
              new_string: NEW_CASE.en.new,
            },
          ],
        },
        { text: "Added it: 10% off the 180 invoice should come to 162." },
      ],
    },
    {
      prompt: "Run the checks and fix whatever fails.",
      steps: [
        {
          thinking: "Run the checks first and read which cases fail.",
          call: ["exec_command", { description: "Run the invoice checks", cmd: RUN }],
        },
        {
          thinking:
            "Both failures come from applyDiscount subtracting the percentage. Take it off the amount and round to cents.",
          call: [
            "edit_file",
            { file_path: "src/total.js", old_string: FIX.old, new_string: FIX.new },
          ],
        },
        { call: ["exec_command", { description: "Run the invoice checks", cmd: RUN }] },
        {
          text: "Two checks failed because `applyDiscount` subtracted the percentage as an amount (190 instead of 180, 170 instead of 162). It now takes the percentage off and rounds to cents, and all three checks pass.",
        },
      ],
    },
  ],
  zh: [
    {
      prompt: "读一下 src/total.js，说说 applyDiscount 做了什么。",
      steps: [
        { thinking: "先读文件再回答。", call: ["read_file", { file_path: "src/total.js" }] },
        {
          text: "`applyDiscount(amount, percent)` 返回 `amount - percent`，把百分比当成了金额。`invoiceTotal` 把每行的单价乘数量相加，再把小计交给它。",
        },
      ],
    },
    {
      prompt: "在 scripts/check.mjs 里加一项整张发票打 9 折的检查。",
      steps: [
        {
          call: [
            "edit_file",
            {
              file_path: "scripts/check.mjs",
              old_string: NEW_CASE.zh.old,
              new_string: NEW_CASE.zh.new,
            },
          ],
        },
        { text: "已加上：180 元的发票打 9 折应为 162。" },
      ],
    },
    {
      prompt: "跑一遍检查，没通过的都修好。",
      steps: [
        {
          thinking: "先跑检查，看哪几项失败。",
          call: ["exec_command", { description: "运行发票检查", cmd: RUN }],
        },
        {
          thinking:
            "两项失败都因为 applyDiscount 直接减去百分比。改成按百分比扣减，再四舍五入到分。",
          call: [
            "edit_file",
            { file_path: "src/total.js", old_string: FIX.old, new_string: FIX.new },
          ],
        },
        { call: ["exec_command", { description: "运行发票检查", cmd: RUN }] },
        {
          text: "有 2 项检查失败，原因是 `applyDiscount` 把百分比当成金额直接减掉了（得到 190，应为 180；得到 170，应为 162）。现在改为按百分比扣减并四舍五入到分，3 项检查全部通过。",
        },
      ],
    },
  ],
};
const TITLES = { en: "Fix the invoice discount", zh: "修复发票折扣" };

// ---------------------------------------------------------------------------
// Mock model (OpenAI chat-completions SSE).
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The step the request is at: its round from the last user message, its step from the tool results after it. */
function stepOf(messages) {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const prompt = JSON.stringify(messages[lastUser]?.content ?? "");
  const after = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
  for (const lang of ["en", "zh"]) {
    for (const round of ROUNDS[lang]) {
      if (prompt.includes(JSON.stringify(round.prompt).slice(1, -1))) {
        return round.steps[Math.min(after, round.steps.length - 1)];
      }
    }
  }
  return { text: "OK." };
}

let callSeq = 0;

async function openaiReply(res, body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
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
  // A coding agent's request: the system prompt and tool schemas, then the conversation.
  const prompt = 11800 + 420 * messages.length;
  const done = (reason, completion) => {
    chunk({}, reason, {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_tokens_details: { cached_tokens: messages.length <= 2 ? 0 : prompt - 640 },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  };
  chunk({ role: "assistant" });
  if (flat.includes("You are a title generator")) {
    chunk({ content: flat.includes(ROUNDS.zh[0].prompt) ? TITLES.zh : TITLES.en });
    done("stop", 8);
    return;
  }
  const step = stepOf(messages);
  await sleep(700);
  let completion = 0;
  if (step.thinking) {
    for (const part of step.thinking.match(/[\s\S]{1,12}/g) ?? []) {
      chunk({ reasoning_content: part });
      completion += 3;
      await sleep(25);
    }
  }
  if (step.text) {
    for (const part of step.text.match(/[\s\S]{1,16}/g) ?? []) {
      chunk({ content: part });
      completion += 4;
      await sleep(25);
    }
  }
  if (step.call) {
    const [name, args] = step.call;
    callSeq += 1;
    chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_${String(callSeq).padStart(2, "0")}${Math.random().toString(16).slice(2, 12)}`,
          type: "function",
          function: { name, arguments: "" },
        },
      ],
    });
    for (const part of JSON.stringify(args).match(/[\s\S]{1,32}/g) ?? []) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
      completion += 6;
      await sleep(25);
    }
    done("tool_calls", completion + 20);
    return;
  }
  done("stop", completion + 12);
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

/** Send one round and wait until the Session is idle again. */
async function runRound(cookie, sessionId, prompt) {
  await api(cookie, "POST", `/api/sessions/${sessionId}/tasks`, {
    input: [{ type: "text", text: prompt }],
  });
  let seenRunning = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const status = (await api(cookie, "GET", `/api/sessions/${sessionId}`)).json.session?.status;
    if (status === "running") seenRunning = true;
    if (status === "idle" && (seenRunning || i > 6)) return;
  }
  throw new Error(`round did not finish: ${prompt}`);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const { chromium } = await import("@playwright/test");
const srvDir = path.join(SCRATCH, "srv");
rmSync(srvDir, { recursive: true, force: true });
// What the server sees: /srv/… inside its namespace, or the scratch directory itself.
const seen = BIND_SRV ? "/srv" : srvDir;
const projectDirs = Object.fromEntries(
  LANGS.map((lang) => [lang, lang === "zh" ? "invoice-tool-zh" : "invoice-tool"]),
);
for (const lang of LANGS) {
  const dir = path.join(srvDir, "projects", projectDirs[lang]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "invoice-tool", private: true, type: "module", scripts: { check: RUN } }, null, 2)}\n`,
  );
  writeFileSync(path.join(dir, "src", "total.js"), TOTAL_JS);
  writeFileSync(path.join(dir, "scripts", "check.mjs"), checkScript(lang));
}
mkdirSync(path.join(srvDir, "penguin"), { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const mock = await startMock();
console.log(`[trace] mock LLM on ${MOCK}`);

const offset = Math.round((NOW.getTime() - Date.now()) / 1000);
const clockEnv = fakeClockEnv(offset);
const serverEntry = path.join(ROOT, "packages/server/dist/index.js");
const [cmd, args] = BIND_SRV
  ? [
      "unshare",
      [
        "-Urm",
        "sh",
        "-c",
        'mount --bind "$SHOT_SRV_DIR" /srv && exec "$SHOT_NODE" "$SHOT_SERVER_ENTRY"',
      ],
    ]
  : [process.execPath, [serverEntry]];
const srv = spawn(cmd, args, {
  env: {
    ...process.env,
    ...clockEnv,
    SHOT_SRV_DIR: srvDir,
    SHOT_NODE: process.execPath,
    SHOT_SERVER_ENTRY: serverEntry,
    LANG: "C.UTF-8",
    PENGUIN_HOME: `${seen}/penguin`,
    PENGUIN_WEB_DB: `${seen}/penguin/web.db`,
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
  console.log(`[trace] server ready on ${BASE}`);

  // Rotate the seeded password, or a banner covers the top of every shot.
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
        // The catalog's list price for this model (CNY 0.3 / 9 / 27 per million, in USD).
        pricing: { cacheRead: 0.042857, cacheWrite: 1.285714, output: 3.857143 },
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
    const rounds = ROUNDS[lang];
    const sessionId = (
      await api(cookie, "POST", `/api/projects/${projectId}/agents/default_agent/sessions`, {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        approvalMode: "allow-all",
        workspace: `${seen}/projects/${projectDirs[lang]}`,
      })
    ).json.session.sessionId;
    for (const [i, round] of rounds.entries()) {
      // Before the last round the reader raises the thinking level, as from the composer.
      if (i === rounds.length - 1) {
        await api(cookie, "PATCH", `/api/sessions/${sessionId}`, { thinkingLevel: "high" });
      }
      await runRound(cookie, sessionId, round.prompt);
      console.log(`[trace] ${lang} round ${i + 1} done`);
    }

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1500 },
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
        // The side panel at its widest for this window.
        localStorage.setItem("penguin.panelWidth", "720");
      },
      [lang, projectId, DARK],
    );
    const page = await context.newPage();
    lastPage = page;
    if (clockEnv.FAKETIME) await page.clock.install({ time: new Date(Date.now() + offset * 1000) });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const res = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: "admin", password: ADMIN_PASSWORD },
    });
    if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
    await page.goto(`${BASE}/chat/${sessionId}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.getByText(rounds.at(-1).prompt, { exact: true }).first().waitFor({ timeout: 60000 });
    if (
      await page
        .getByRole("dialog")
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await page.keyboard.press("Escape");
    }

    // The Trace panel in the right dock.
    await page.getByTestId("dock-toggle-right").click();
    await page.getByTestId("dock-pick-trace").click();
    const dock = page.locator('[data-testid="dock"][data-position="right"][data-open="true"]');
    await dock.locator("[data-round]").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    // From the top: the summary, then the ruled rounds, the newest one open on its rows.
    await dock.evaluate((el) => {
      for (const box of el.querySelectorAll("*")) {
        if (
          box.scrollHeight > box.clientHeight + 4 &&
          getComputedStyle(box).overflowY !== "visible"
        ) {
          box.scrollTop = 0;
        }
      }
    });
    await page.waitForTimeout(800);
    // The check run that exited 1, opened: its output, and no status mark, as for any completed call.
    const failed = dock.locator("[data-trace-row]").filter({ hasText: FAIL_MARK[lang] }).first();
    await failed.locator("button").first().click();
    await page.waitForTimeout(900);

    if (HOVER) {
      // Review only: the newest round's context ring opened on its readings.
      const ring = dock.locator("[data-round]").last().locator('[data-slot="ring"]').first();
      await ring.click();
      await page.waitForTimeout(800);
    }
    if (NAV) {
      // Review only: the round navigator open from the toolbar.
      await dock.locator('[data-slot="nav-button"]').first().click();
      await page.waitForTimeout(900);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);

    // The dock from its tab strip down to the row after the opened one: the panel scrolls on
    // past it, and a row cut by the window's edge would read as a clipped label.
    const box = await dock.boundingBox();
    const rowBottom = await dock.evaluate(
      (el, [limit, mark]) => {
        const opened = [...el.querySelectorAll("[data-trace-row]")].find((row) =>
          new RegExp(mark).test(row.textContent),
        );
        const last = opened?.nextElementSibling ?? opened;
        const bottom = last?.getBoundingClientRect().bottom ?? 0;
        return bottom <= limit ? bottom : 0;
      },
      [box.y + box.height - 1, FAIL_MARK[lang].source],
    );
    if (rowBottom > 0) box.height = Math.min(box.height, rowBottom + 1 - box.y);
    const file = `penguinharness-0-2-17-trace-${lang}${SUFFIX}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), clip: box });
    writeFileSync(
      path.join(OUT_DIR, file.replace(/\.png$/, ".txt")),
      await dock.evaluate((el) => el.innerText),
    );
    console.log(`[trace] ${file} ${JSON.stringify(box)}`);
    await page.screenshot({ path: path.join(OUT_DIR, `full-${lang}${SUFFIX}.png`) });
    await context.close();
  }

  await browser.close();
  console.log(`[trace] done -> ${OUT_DIR}`);
  process.exit(0);
} catch (err) {
  console.error("[trace] FAILED:", err);
  try {
    if (lastPage && !lastPage.isClosed()) {
      const dump = path.join(SCRATCH, "debug");
      mkdirSync(dump, { recursive: true });
      writeFileSync(path.join(dump, "trace-failure.png"), await lastPage.screenshot());
      writeFileSync(
        path.join(dump, "trace-failure.txt"),
        await lastPage.evaluate(() => document.body.innerText),
      );
    }
  } catch {}
  process.exit(1);
}
