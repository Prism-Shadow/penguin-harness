/**
 * 0.2.14 release post, "Also in this release": the same finished conversation in Frost,
 * Console and Primer (light), and the Plugins page's card grid. One run shoots en and zh.
 *
 * A scripted mock LLM (Anthropic Messages SSE) drives a real conversation against the built
 * server on a scratch data root: real exec_command runs and a real edit_file in a staged
 * Workspace. Output: PNGs in $SHOT_OUT (raw, 2x); composition and quantization happen after.
 *
 * Env: SHOT_TREE (built checkout), SHOT_SCRATCH (data root parent), SHOT_OUT, SHOT_WS (workspace
 * parent, outside any home directory so no shot shows one), SRV_PORT, MOCK_PORT.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const TREE = process.env.SHOT_TREE;
const SCRATCH = process.env.SHOT_SCRATCH;
const OUT = process.env.SHOT_OUT;
const WS_ROOT = process.env.SHOT_WS;
const SRV_PORT = Number(process.env.SRV_PORT || 19150);
const MOCK_PORT = Number(process.env.MOCK_PORT || 19151);
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SEED = "penguin-2026";
const ONLY = (process.env.SHOT_ONLY || "themes,plugins").split(",");
const LANGS = (process.env.SHOT_LANGS || "en,zh").split(",");

const MODEL = {
  provider: "custom",
  modelId: "claude-sonnet-5-5",
  displayName: "Claude Sonnet 5.5",
};

// ---------------------------------------------------------------------------------- scenes

const OLD_LINE = "  return items.reduce((sum, item) => sum + item.amount, 0);";
const NEW_LINES =
  "  const cents = items.reduce((n, item) => n + Math.round(item.amount * 100), 0);\n  return cents / 100;";

const SCENES = {
  en: {
    user: { userId: "alex", nickname: "Alex" },
    extras: [
      {
        prompt: "Which checks does scripts/check.mjs run? One line each.",
        reply:
          "Six checks, all on `sumLineItems` in `src/total.mjs`:\n\n1. an empty invoice totals 0\n2. a single item\n3. whole amounts\n4. 0.10 + 0.20\n5. 1,000 line items of 0.01\n6. a credit line",
        title: "Invoice check suite",
      },
      {
        prompt: "Is there a script that exports invoices as CSV?",
        reply: "Not yet. `src/` holds only `total.mjs`, and `scripts/` only `check.mjs`.",
        title: "CSV export script",
      },
    ],
    main: {
      prompt: "The invoice check fails on 0.10 + 0.20. Find out why and fix it.",
      title: "Fix invoice total rounding",
      t1Thinking: "Run the check suite first to see every failure, not just the one reported.",
      final:
        "Fixed. `sumLineItems` added the amounts as floating-point numbers, so `0.10 + 0.20` came out as `0.30000000000000004` and the strict comparison failed. Two more checks failed the same way.\n\n- It now sums whole cents and divides once at the end.\n- All six checks pass.\n\n```js\nconst cents = items.reduce((n, item) => n + Math.round(item.amount * 100), 0);\nreturn cents / 100;\n```",
      finalMarker: "All six checks pass",
    },
  },
  zh: {
    user: { userId: "mei", nickname: "小梅" },
    extras: [
      {
        prompt: "scripts/check.mjs 跑了哪些检查？每项一行。",
        reply:
          "共六项，都针对 `src/total.mjs` 里的 `sumLineItems`：\n\n1. 空发票合计为 0\n2. 单个条目\n3. 整数金额\n4. 0.10 + 0.20\n5. 1000 个 0.01 的条目\n6. 一条退款行",
        title: "发票检查项一览",
      },
      {
        prompt: "有没有把发票导出成 CSV 的脚本？",
        reply: "还没有。`src/` 下只有 `total.mjs`，`scripts/` 下只有 `check.mjs`。",
        title: "CSV 导出脚本",
      },
    ],
    main: {
      prompt: "发票检查在 0.10 + 0.20 这一项上失败了，查一下原因并修好。",
      title: "修复发票合计的舍入误差",
      t1Thinking: "先把检查全部跑一遍，看清所有失败项，而不只是报告的那一项。",
      final:
        "已修复。`sumLineItems` 直接按浮点数相加，`0.10 + 0.20` 得到 `0.30000000000000004`，严格比较因此失败；另外两项也是同一个原因。\n\n- 现在先按整数分求和，最后再除一次 100。\n- 六项检查全部通过。\n\n```js\nconst cents = items.reduce((n, item) => n + Math.round(item.amount * 100), 0);\nreturn cents / 100;\n```",
      finalMarker: "六项检查全部通过",
    },
  },
};

function stageWorkspace(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(
    path.join(dir, "src/total.mjs"),
    `/** Sum an invoice's line items. */\nexport function sumLineItems(items) {\n${OLD_LINE}\n}\n`,
  );
  writeFileSync(
    path.join(dir, "scripts/check.mjs"),
    `// Checks for sumLineItems (src/total.mjs).
import { sumLineItems } from "../src/total.mjs";
const items = (...amounts) => amounts.map((amount) => ({ amount }));
const cases = [
  ["empty invoice", items(), 0],
  ["single item", items(12.5), 12.5],
  ["whole amounts", items(40, 2), 42],
  ["0.10 + 0.20", items(0.1, 0.2), 0.3],
  ["1,000 line items of 0.01", items(...Array(1000).fill(0.01)), 10],
  ["credit line", items(19.99, -5), 14.99],
];
let failed = 0;
for (const [name, input, want] of cases) {
  const got = sumLineItems(input);
  if (got === want) console.log(\`  ✓ \${name}\`);
  else {
    failed += 1;
    console.log(\`  ✗ \${name}: expected \${want}, got \${got}\`);
  }
}
console.log(failed ? \`\${failed} failed, \${cases.length - failed} passed\` : \`\${cases.length} passed\`);
process.exit(failed ? 1 : 0);
`,
  );
  writeFileSync(
    path.join(dir, "README.md"),
    "# invoice-tools\n\nInvoice totals and their checks.\n",
  );
}

// ---------------------------------------------------------------------------------- mock LLM

function sse(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function start(res, msgCount) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: `msg_shot_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: MODEL.modelId,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 420,
        output_tokens: 0,
        cache_read_input_tokens: 1800 * msgCount,
        cache_creation_input_tokens: 600,
      },
    },
  });
}
function stop(res, reason, out) {
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: out },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}
function block(res, index, startBlock, deltas, extra) {
  sse(res, "content_block_start", {
    type: "content_block_start",
    index,
    content_block: startBlock,
  });
  for (const d of deltas)
    sse(res, "content_block_delta", { type: "content_block_delta", index, delta: d });
  if (extra) sse(res, "content_block_delta", { type: "content_block_delta", index, delta: extra });
  sse(res, "content_block_stop", { type: "content_block_stop", index });
}
const pieces = (s, n) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) ?? [];
const text = (res, i, s) =>
  block(
    res,
    i,
    { type: "text", text: "" },
    pieces(s, 24).map((t) => ({ type: "text_delta", text: t })),
  );
const thinking = (res, i, s) =>
  block(
    res,
    i,
    { type: "thinking", thinking: "" },
    pieces(s, 24).map((t) => ({ type: "thinking_delta", thinking: t })),
    { type: "signature_delta", signature: "sig_shot" },
  );
const tool = (res, i, name, args) =>
  block(
    res,
    i,
    { type: "tool_use", id: `toolu_shot_${Date.now()}_${i}`, name, input: {} },
    pieces(JSON.stringify(args), 40).map((p) => ({ type: "input_json_delta", partial_json: p })),
  );

function reply(res, body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
  const sys = JSON.stringify(body.system ?? "");
  start(res, messages.length);
  if (flat.includes("You are a title generator.") || sys.includes("You are a title generator.")) {
    for (const lang of Object.keys(SCENES)) {
      const s = SCENES[lang];
      if (flat.includes(s.main.prompt))
        return (text(res, 0, s.main.title), stop(res, "end_turn", 8));
      for (const e of s.extras)
        if (flat.includes(e.prompt)) return (text(res, 0, e.title), stop(res, "end_turn", 8));
    }
    text(res, 0, "Conversation");
    return stop(res, "end_turn", 4);
  }
  for (const lang of Object.keys(SCENES)) {
    const s = SCENES[lang];
    for (const e of s.extras) {
      if (flat.includes(e.prompt)) {
        text(res, 0, e.reply);
        return stop(res, "end_turn", 90);
      }
    }
    if (flat.includes(s.main.prompt)) {
      const results = flat.split('"tool_result"').length - 1;
      const m = s.main;
      if (results === 0) {
        thinking(res, 0, m.t1Thinking);
        tool(res, 1, "exec_command", { cmd: "node scripts/check.mjs" });
        return stop(res, "tool_use", 60);
      }
      if (results === 1) {
        tool(res, 0, "edit_file", {
          file_path: "src/total.mjs",
          old_string: OLD_LINE,
          new_string: NEW_LINES,
        });
        return stop(res, "tool_use", 120);
      }
      if (results === 2) {
        tool(res, 0, "exec_command", { cmd: "node scripts/check.mjs" });
        return stop(res, "tool_use", 40);
      }
      text(res, 0, m.final);
      return stop(res, "end_turn", 260);
    }
  }
  text(res, 0, "OK.");
  stop(res, "end_turn", 2);
}

function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.includes("messages")) {
        console.log(`[mock] ${req.method} ${req.url} -> 404`);
        res.writeHead(404).end();
        return;
      }
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {}
      try {
        reply(res, json);
      } catch (err) {
        console.error("[mock] error", err);
        try {
          res.end();
        } catch {}
      }
    });
  });
  return new Promise((r) => server.listen(MOCK_PORT, "127.0.0.1", () => r(server)));
}

// ---------------------------------------------------------------------------------- API

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const textBody = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${textBody.slice(0, 400)}`);
  let json = {};
  try {
    json = JSON.parse(textBody);
  } catch {}
  return { json, setCookie: res.headers.get("set-cookie") };
}
async function login(userId, password) {
  const { setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  return setCookie.split(";")[0];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(cookie, sessionId, wantTitle) {
  for (let i = 0; i < 120; i++) {
    const { json } = await api(cookie, "GET", `/api/sessions/${sessionId}`);
    const s = json.session ?? {};
    if (s.status === "idle" && (!wantTitle || s.title)) return s;
    await sleep(500);
  }
  throw new Error(`session ${sessionId} did not settle`);
}

async function setupUser(adminCookie, lang) {
  const { userId, nickname } = SCENES[lang].user;
  const initial = `${userId}-initial-1`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial }).catch((e) => {
    if (!String(e).includes("409")) throw e;
  });
  let cookie = await login(userId, initial);
  const password = `penguin-${userId}-2026`;
  await api(cookie, "PUT", "/api/me/password", { oldPassword: initial, newPassword: password });
  cookie = await login(userId, password);
  await api(cookie, "PUT", "/api/me/profile", { displayName: nickname }).catch((e) =>
    console.log(`[shot] profile: ${e}`),
  );
  const projectId = (await api(cookie, "GET", "/api/projects")).json.projects[0].projectId;
  await setModel(cookie, projectId);
  return { userId, password, cookie, projectId };
}

async function setModel(cookie, projectId) {
  await api(cookie, "PUT", `/api/projects/${projectId}/models`, {
    defaultModel: { provider: MODEL.provider, modelId: MODEL.modelId },
    models: [
      {
        provider: MODEL.provider,
        modelId: MODEL.modelId,
        displayName: MODEL.displayName,
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
      },
    ],
  });
}

async function runSession(user, workspace, prompt) {
  const sess = (
    await api(
      user.cookie,
      "POST",
      `/api/projects/${user.projectId}/agents/default_agent/sessions`,
      {
        provider: MODEL.provider,
        modelId: MODEL.modelId,
        approvalMode: "allow-all",
        workspace,
      },
    )
  ).json;
  const sessionId = sess.session.sessionId;
  await api(user.cookie, "POST", `/api/sessions/${sessionId}/tasks`, {
    input: [{ type: "text", text: prompt }],
  });
  const info = await waitIdle(user.cookie, sessionId, true);
  console.log(`[shot] ${sessionId} "${info.title}" ${info.status}`);
  return sessionId;
}

// ---------------------------------------------------------------------------------- main

const dataRoot = path.join(SCRATCH, "data");
rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });
mkdirSync(OUT, { recursive: true });

const mock = await startMock();
const srv = spawn("node", [path.join(TREE, "packages/server/dist/index.js")], {
  env: {
    ...process.env,
    PENGUIN_HOME: path.join(dataRoot, "home"),
    PENGUIN_WEB_DB: path.join(dataRoot, "web.db"),
    PENGUIN_WEB_DIST: path.join(TREE, "packages/web/dist"),
    PORT: String(SRV_PORT),
    HOST: "127.0.0.1",
    PENGUIN_SEED_ADMIN_PASSWORD: SEED,
    TZ: "Asia/Shanghai",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stdout.on("data", (d) => process.stdout.write(`[srv] ${d}`));
srv.stderr.on("data", (d) => process.stdout.write(`[srv!] ${d}`));
process.on("exit", () => {
  try {
    srv.kill();
  } catch {}
  try {
    mock.close();
  } catch {}
});

let lastPage;
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) break;
    } catch {}
    await sleep(500);
  }
  let adminCookie;
  for (let i = 0; ; i++) {
    try {
      adminCookie = await login("admin", SEED);
      break;
    } catch (e) {
      if (i >= 20) throw e;
      await sleep(1000);
    }
  }
  const adminPassword = "penguin-admin-2026";
  await api(adminCookie, "PUT", "/api/me/password", {
    oldPassword: SEED,
    newPassword: adminPassword,
  });
  adminCookie = await login("admin", adminPassword);
  const adminProject = (await api(adminCookie, "GET", "/api/projects")).json.projects[0].projectId;
  await setModel(adminCookie, adminProject);

  const browser = await chromium.launch({
    env: {
      ...process.env,
      FONTCONFIG_FILE: path.join(TREE, "packages/ui-gallery/scripts/fonts.conf"),
      LANG: "en_US.UTF-8",
    },
  });

  async function openPage(creds, lang, themeId, projectId, url, viewport) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: lang === "zh" ? "zh-CN" : "en-US",
      timezoneId: "Asia/Shanghai",
    });
    await context.addInitScript(
      ([t, l, p]) => {
        try {
          localStorage.setItem("penguin.themeId", t);
          localStorage.setItem("penguin.theme", "light");
          localStorage.setItem("penguin.lang", l);
          localStorage.setItem("penguin.lastProjectId", p);
        } catch {}
      },
      [themeId, lang, projectId],
    );
    const page = await context.newPage();
    lastPage = page;
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const r = await page.request.post(`${BASE}/api/auth/login`, {
      data: { userId: creds.userId, password: creds.password },
      headers: { origin: BASE },
    });
    if (!r.ok()) throw new Error(`browser login ${r.status()}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { context, page };
  }

  for (const lang of LANGS) {
    const scene = SCENES[lang];
    if (ONLY.includes("themes")) {
      const user = await setupUser(adminCookie, lang);
      const ws = path.join(WS_ROOT, lang, "invoice-tools");
      stageWorkspace(ws);
      for (const e of scene.extras) await runSession(user, ws, e.prompt);
      await sleep(1500);
      const mainId = await runSession(user, ws, scene.main.prompt);
      for (const themeId of ["modern", "geek", "github"]) {
        const { context, page } = await openPage(
          user,
          lang,
          themeId,
          user.projectId,
          `${BASE}/chat/${mainId}`,
          { width: 1280, height: 800 },
        );
        try {
          await page.getByText(scene.main.finalMarker).first().waitFor({ timeout: 30000 });
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(800);
          if (process.env.SHOT_EXPAND !== "0") {
            await page
              .getByText(/^(Done|运行完毕)$/)
              .first()
              .click()
              .catch((e) => console.log(`[shot] expand: ${e}`));
          }
          await page.mouse.move(1270, 790);
          await page.waitForTimeout(2500);
          const name = `themes-${themeId}-${lang}`;
          await page.screenshot({ path: path.join(OUT, `${name}.png`) });
          writeFileSync(
            path.join(OUT, `${name}.txt`),
            await page.evaluate(() => document.body.innerText),
          );
          console.log(`[shot] ${name}`);
        } finally {
          await context.close();
        }
      }
    }
    if (ONLY.includes("plugins")) {
      const { context, page } = await openPage(
        { userId: "admin", password: adminPassword },
        lang,
        "modern",
        adminProject,
        `${BASE}/plugins`,
        { width: 1440, height: 900 },
      );
      page.on("response", (r) => {
        if (r.url().includes("/api/plugins")) console.log(`[net] ${r.status()} ${r.url()}`);
      });
      page.on("console", (m) => {
        if (m.type() === "error") console.log(`[console] ${m.text()}`);
      });
      try {
        const sandboxTitle = lang === "zh" ? "Agent 运行沙箱" : "Agent Sandbox";
        // The registry answers once every source has: an unreachable remote index costs ~30 s.
        await page.getByText(sandboxTitle, { exact: true }).first().waitFor({ timeout: 90000 });
        const fold =
          lang === "zh"
            ? ["Agent 自进化", "办公效率", "软件开发", "AI 应用开发"]
            : [
                "Agent Self-Evolution",
                "Office Productivity",
                "Software Development",
                "AI App Development",
              ];
        for (const title of fold) {
          await page
            .getByText(title, { exact: true })
            .first()
            .click()
            .catch((e) => console.log(`[shot] fold: ${e}`));
          await page.waitForTimeout(400);
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.mouse.move(1430, 890);
        await page.waitForTimeout(1500);
        const name = `plugins-${lang}`;
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
        writeFileSync(
          path.join(OUT, `${name}.txt`),
          await page.evaluate(() => document.body.innerText),
        );
        console.log(`[shot] ${name}`);
      } finally {
        await context.close();
      }
    }
  }
  await browser.close();
  console.log("[shot] done");
  process.exit(0);
} catch (err) {
  console.error("[shot] FAILED", err);
  try {
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: path.join(OUT, "failure.png") });
      writeFileSync(
        path.join(OUT, "failure.txt"),
        await lastPage.evaluate(() => document.body.innerText),
      );
    }
  } catch {}
  process.exit(1);
}
