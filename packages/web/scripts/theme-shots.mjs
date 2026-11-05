/**
 * Pixel-diff harness for theme work: screenshots the real app built two (or more) ways against the
 * SAME server, data and clock, then compares the shots pixel for pixel.
 *
 *   node scripts/theme-shots.mjs capture --out <dir> before=<web dist> after=<web dist>
 *   node scripts/theme-shots.mjs diff <dir>/before <dir>/after [--diff-out <dir>]
 *
 * `capture` hosts a scripted mock LLM, starts the built server (packages/server/dist) on a
 * throwaway data root, provisions one user per UI language, drives one real conversation each
 * (a thinking block, a tool call that executes, a Markdown answer with code, a table and links),
 * and then, per language × mode (light / dark) × variant, screenshots twelve pages into
 * `<out>/<variant>/<lang>/<mode>/<page>.png`. Every variant is served by the one server: page
 * requests are fulfilled from that variant's dist through Playwright routing, while `/api` reaches
 * the server, so the only thing that differs between two shots is the bundle.
 *
 * What keeps runs comparable: `Date.now()` is frozen after seeding (relative times stay put), a
 * warm-up pass visits every page first (read marks and lazy server state settle before any
 * shot), Chromium rasterises without the GPU, animations are finished or cancelled at capture,
 * the caret is hidden, and a shot is kept only once two consecutive captures agree. Passing the
 * same dist twice (`before=<dist> again=<dist>`) measures the harness's own noise floor.
 *
 * `diff` compares two shot trees. Identical PNG bytes pass outright; otherwise both images are
 * decoded in Chromium and compared exactly (threshold 0) — any differing pixel fails, and a diff
 * image with the differing pixels in red is written for inspection. Exit code 1 on any difference.
 *
 * Prereqs: `pnpm --filter "@prismshadow/penguin-server..." build`, each variant's web dist, and
 * Playwright's Chromium. Local only; never committed output.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRV_PORT = Number(process.env.THEME_SHOTS_PORT || 8950);
const MOCK_PORT = SRV_PORT + 1;
// `localhost`, not `127.0.0.1`: that literal address is the Workspace-preview host and the API
// answers 401 on it.
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const ADMIN_PASSWORD = "penguin-0000";
// THEME_SHOTS_LANGS / THEME_SHOTS_MODES / THEME_SHOTS_PAGES (comma lists) narrow a run while
// investigating one difference; a verdict is only ever the full matrix.
const LANGS = process.env.THEME_SHOTS_LANGS?.split(",") ?? ["en", "zh"];
const MODES = process.env.THEME_SHOTS_MODES?.split(",") ?? ["light", "dark"];
const VIEWPORT = { width: 1280, height: 800 };

// ---------------------------------------------------------------------------
// The scripted conversation.
// ---------------------------------------------------------------------------

const DONE_MARKER = "theme-shots-done";
const CMD = "printf 'palette\\ntokens\\nthemes\\n' | sort";

const SCRIPTS = {
  en: {
    marker: "theme audit",
    prompt: "Run a quick theme audit of this workspace and summarise it.",
    title: "Theme audit",
    thinking:
      "A short audit: list the three theme files, then summarise with a table and a code sample.",
    lead: "Listing what the audit covers first:",
    answer: `The audit is done — see the [token contract](https://example.com/tokens) for names.

| Theme | Radius | Glass |
| --- | --- | --- |
| Primer | 6px | no |
| Frost | 12px | yes |
| Console | 0 | no |

\`\`\`css
:root { --ui-surface: #ffffff; }
\`\`\`

- Inline \`code\` renders on the inset surface;
- Marker: \`${DONE_MARKER}\`.`,
  },
  zh: {
    marker: "主题审计",
    prompt: "对这个工作区做一次快速的主题审计并总结。",
    title: "主题审计",
    thinking: "简短审计：先列出三个主题文件，再用表格和代码示例总结。",
    lead: "先列出审计覆盖的内容：",
    answer: `审计完成，名称见[令牌契约](https://example.com/tokens)。

| 主题 | 圆角 | 磨砂 |
| --- | --- | --- |
| Primer | 6px | 否 |
| Frost | 12px | 是 |
| Console | 0 | 否 |

\`\`\`css
:root { --ui-surface: #ffffff; }
\`\`\`

- 行内 \`code\` 画在嵌入面上；
- 标记：\`${DONE_MARKER}\`。`,
  },
};

const scriptFor = (flat) => (flat.includes(SCRIPTS.zh.marker) ? SCRIPTS.zh : SCRIPTS.en);

function openaiReply(res, body) {
  const flat = JSON.stringify(body.messages ?? []);
  const script = scriptFor(flat);
  const isTitle = flat.includes("concise title");
  const toolDone = flat.includes('"role":"tool"');
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta, finishReason = null, usage) => {
    const payload = {
      id: "chatcmpl-theme-shots",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "deepseek-v4-pro",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) payload.usage = usage;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const usage = {
    prompt_tokens: 5200,
    completion_tokens: 420,
    total_tokens: 5620,
    prompt_cache_hit_tokens: 4300,
    prompt_cache_miss_tokens: 900,
  };
  const pieces = (s, n) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) ?? [];
  chunk({ role: "assistant" });
  if (isTitle) {
    chunk({ content: script.title });
    chunk({}, "stop", usage);
  } else if (!toolDone) {
    for (const t of pieces(script.thinking, 18)) chunk({ reasoning_content: t });
    for (const t of pieces(script.lead, 24)) chunk({ content: t });
    chunk({
      tool_calls: [
        {
          index: 0,
          id: "call_theme_shots_1",
          type: "function",
          function: { name: "exec_command", arguments: "" },
        },
      ],
    });
    for (const part of pieces(JSON.stringify({ cmd: CMD }), 32)) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    }
    chunk({}, "tool_calls", usage);
  } else {
    for (const t of pieces(script.answer, 24)) chunk({ content: t });
    chunk({}, "stop", usage);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {}
      if (req.method === "POST" && req.url?.includes("chat/completions"))
        return openaiReply(res, json);
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
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return { json: await res.json().catch(() => ({})), setCookie: res.headers.get("set-cookie") };
}

async function login(userId, password) {
  const { json, setCookie } = await api(null, "POST", "/api/auth/login", { userId, password });
  if (!setCookie) throw new Error("no session cookie from login");
  return { cookie: setCookie.split(";")[0], user: json.user };
}

const USERS = {
  en: {
    userId: "alex",
    agents: [
      { agentId: "data_analyst", name: "Data Analyst", description: "CSV analysis and charts" },
      { agentId: "web_scout", name: "Web Scout", description: "Web research and fact checking" },
    ],
  },
  zh: {
    userId: "demo",
    agents: [
      { agentId: "data_analyst", name: "数据分析师", description: "CSV 数据分析与图表" },
      { agentId: "web_scout", name: "网页调研员", description: "网页检索与信息核对" },
    ],
  },
};

async function provisionUser(adminCookie, lang, wsRoot) {
  const { userId, agents } = USERS[lang];
  const initial = `${userId}12345`;
  const password = `penguin-${userId}-2026`;
  await api(adminCookie, "POST", "/api/admin/users", { userId, password: initial });
  let session = await login(userId, initial);
  // Rotate once so the initial-password banner stays out of the shots.
  await api(session.cookie, "PUT", "/api/me/password", {
    oldPassword: initial,
    newPassword: password,
  });
  session = await login(userId, password);
  const projectId = (await api(session.cookie, "GET", "/api/projects")).json.projects[0].projectId;
  await api(session.cookie, "PUT", `/api/projects/${projectId}/models`, {
    defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    models: [
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        clientType: "openai-chat",
        apiKey: "sk-demo",
        baseUrl: MOCK,
        contextWindow: 1000000,
        pricing: { cacheRead: 0.003571, cacheWrite: 0.428571, output: 0.857143 },
      },
    ],
  });
  for (const agent of agents) {
    await api(session.cookie, "POST", `/api/projects/${projectId}/agents`, agent);
  }
  const ws = path.join(wsRoot, lang);
  mkdirSync(ws, { recursive: true });
  const created = await api(
    session.cookie,
    "POST",
    `/api/projects/${projectId}/agents/default_agent/sessions`,
    { provider: "deepseek", modelId: "deepseek-v4-pro", approvalMode: "allow-all", workspace: ws },
  );
  return { userId, password, projectId, sessionId: created.json.session.sessionId };
}

// ---------------------------------------------------------------------------
// Browser helpers.
// ---------------------------------------------------------------------------

/** A context whose page requests are answered from `dist`; `/api` still reaches the server. */
async function newContext(browser, { dist, lang, mode, user, fixedNow, reducedMotion }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: mode,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript(
    ([m, l]) => {
      localStorage.setItem("penguin.theme", m);
      localStorage.setItem("penguin.lang", l);
      localStorage.setItem("penguin.dock.layout", JSON.stringify({ scopes: {}, bottomRatio: 0.6 }));
    },
    [mode, lang],
  );
  await context.route(
    (url) => url.origin === BASE && !url.pathname.startsWith("/api/"),
    async (route) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
      let file = path.join(dist, rel);
      if (!rel || !existsSync(file) || statSync(file).isDirectory()) {
        file = path.join(dist, "index.html"); // SPA fallback, as the server does
      }
      await route.fulfill({ path: file });
    },
  );
  if (fixedNow !== undefined) await context.clock.setFixedTime(fixedNow);
  if (user) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { userId: user.userId, password: user.password },
    });
    if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
  }
  return context;
}

/**
 * Chromium flags that take the GPU and its timing out of rasterisation. Without them the same
 * build, shot twice, differs by a handful of anti-aliasing pixels on rounded corners and small
 * glyphs — noise that a threshold-0 comparison cannot tell from a real change.
 */
const DETERMINISTIC_ARGS = [
  "--disable-gpu",
  "--disable-gpu-rasterization",
  "--disable-partial-raster",
  "--disable-skia-runtime-opts",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
];

/**
 * A screenshot taken only once three consecutive captures, 300ms apart, agree byte for byte, so a
 * transition or a late layout still settling never lands in a shot.
 */
async function stableScreenshot(page, label) {
  // The session's cost figure is DATA with a load-order race of its own (a stored-rate estimate
  // until the server-priced total lands, or not), so its value is masked; the chip's styling is
  // still covered by the token and duration chips beside it.
  const mask = [page.locator('[title*="（USD）"], [title*="（CNY）"]')];
  let previous = null;
  let agreeing = 0;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const buf = await page.screenshot({ animations: "disabled", caret: "hide", mask });
    agreeing = previous !== null && buf.equals(previous) ? agreeing + 1 : 0;
    if (agreeing === 2) return buf;
    previous = buf;
    await page.waitForTimeout(300);
  }
  console.log(`[theme-shots] never stable: ${label}`);
  return previous;
}

/** Fonts loaded, the network quiet (bounded: a page may hold an event stream open), then a pause. */
async function settle(page, ms = 1200) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Re-shoot rounds for one page. Variants are shot back to back per page, so data that moves with
 * the clock (a cost figure repriced a moment after load) cannot separate them by minutes. When a
 * variant still disagrees with the first, the whole page is re-shot, up to this many rounds: a
 * rendering race disappears on a re-shoot, a real stylesheet difference is deterministic and
 * survives every round. The rounds each page took are logged, so nothing is re-shot silently.
 */
const ROUNDS = 3;

/** The twelve pages. Each leaves the page in the state to capture. */
const PAGES = [
  {
    id: "login",
    auth: false,
    // The circuit-trace background loops on a 14s CSS cycle whose phase at capture time decides
    // a few anti-aliased pixels behind the form; under reduced motion it rests as static lines.
    reducedMotion: true,
    run: async (page) => {
      await page.goto(`${BASE}/login`);
      await page.locator("form button[type=submit]").waitFor({ timeout: 20000 });
    },
  },
  {
    id: "chat-new",
    run: async (page) => {
      await page.goto(`${BASE}/chat`);
      await page.getByPlaceholder(/输入消息|Type a message/).waitFor({ timeout: 20000 });
    },
  },
  {
    id: "chat",
    run: async (page, { user }) => {
      await page.goto(`${BASE}/chat/${user.sessionId}`);
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 30000 });
    },
  },
  {
    id: "trace",
    run: async (page, { user }) => {
      await page.goto(`${BASE}/chat/${user.sessionId}`);
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 30000 });
      await page.getByTestId("dock-toggle-bottom").click();
      const dock = page.locator("[data-testid='dock'][data-position='bottom']");
      await dock.getByTestId("dock-pick-trace").click();
      await dock.locator('[data-tab-id="trace"][data-active="true"]').waitFor({ timeout: 20000 });
      await dock
        .getByTitle(/exec_command/)
        .first()
        .waitFor({ timeout: 30000 });
    },
  },
  {
    id: "user-menu",
    run: async (page, { user }) => {
      await page.goto(`${BASE}/chat/${user.sessionId}`);
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: user.userId }).last().click();
      await page.getByRole("button", { name: /^(System settings|系统设置)$/ }).waitFor();
      await page.mouse.move(0, 0);
    },
  },
  {
    id: "settings",
    run: async (page, { user }) => {
      await page.goto(`${BASE}/chat/${user.sessionId}`);
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: user.userId }).last().click();
      await page.getByRole("button", { name: /^(System settings|系统设置)$/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: /^(Appearance|外观)$/ })
        .first()
        .click();
      await dialog.getByRole("button", { name: /^(Blue|蓝)$/ }).waitFor({ timeout: 10000 });
      await page.mouse.move(0, 0);
    },
  },
  { id: "agents", run: (page) => page.goto(`${BASE}/agents`) },
  { id: "agent-settings", run: (page) => page.goto(`${BASE}/agents/data_analyst`) },
  { id: "plugins", run: (page) => page.goto(`${BASE}/plugins`) },
  { id: "models", run: (page) => page.goto(`${BASE}/models`) },
  { id: "usage", run: (page) => page.goto(`${BASE}/usage`) },
  {
    id: "benchmark",
    run: async (page) => {
      await page.goto(`${BASE}/benchmark`);
      await page.waitForTimeout(1500);
      await page
        .getByText(/Example Benchmark|示例/)
        .first()
        .click({ timeout: 5000 });
    },
  },
];

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

async function capture(args) {
  const outIdx = args.indexOf("--out");
  if (outIdx < 0 || !args[outIdx + 1]) throw new Error("capture needs --out <dir>");
  const out = path.resolve(args[outIdx + 1]);
  const variants = args
    .filter((a, i) => i !== outIdx && i !== outIdx + 1 && a.includes("="))
    .map((a) => {
      const [name, dist] = a.split("=");
      const abs = path.resolve(dist);
      if (!existsSync(path.join(abs, "index.html"))) throw new Error(`no index.html in ${abs}`);
      return { name, dist: abs };
    });
  if (variants.length === 0) throw new Error("capture needs at least one <name>=<dist>");
  const only = process.env.THEME_SHOTS_PAGES?.split(",");
  const pages = only ? PAGES.filter((p) => only.includes(p.id)) : PAGES;

  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "penguin-theme-shots-"));
  const mock = await startMock();
  const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
    env: {
      ...process.env,
      PENGUIN_HOME: path.join(dataRoot, "home"),
      PENGUIN_WEB_DB: path.join(dataRoot, "web.db"),
      PENGUIN_WEB_DIST: variants[0].dist,
      PORT: String(SRV_PORT),
      HOST: "127.0.0.1",
      PENGUIN_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));
  const cleanup = () => {
    srv.kill();
    mock.close();
  };
  process.on("exit", cleanup);

  await waitFor(`${BASE}/`);
  console.log(`[theme-shots] server on ${BASE}, data root ${dataRoot}`);
  // The listener can answer before the seeded admin exists; retry the first login briefly.
  let admin;
  for (let i = 0; !admin; i++) {
    admin = await login("admin", ADMIN_PASSWORD).catch((err) => {
      if (i >= 40) throw err;
      return new Promise((r) => setTimeout(r, 500));
    });
  }
  const browser = await chromium.launch({ args: DETERMINISTIC_ARGS });
  let shots = 0;

  for (const lang of LANGS) {
    const user = { ...(await provisionUser(admin.cookie, lang, path.join(dataRoot, "ws"))), lang };

    // Seed: drive the conversation once, through the UI, to completion.
    {
      const context = await newContext(browser, {
        dist: variants[0].dist,
        lang,
        mode: "light",
        user,
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/chat/${user.sessionId}`);
      const input = page.getByPlaceholder(/输入消息|Type a message/);
      await input.waitFor({ timeout: 20000 });
      await input.fill(SCRIPTS[lang].prompt);
      await page.getByRole("button", { name: /发送|Send/ }).click();
      await page.getByText(DONE_MARKER).first().waitFor({ timeout: 90000 });
      await page.waitForTimeout(3000); // title generation and stats settle
      await context.close();
    }
    const fixedNow = Date.now();

    // Warm-up: every page once, so first-visit side effects land before any shot.
    {
      const context = await newContext(browser, {
        dist: variants[0].dist,
        lang,
        mode: "light",
        user,
        fixedNow,
      });
      const page = await context.newPage();
      for (const def of pages.filter((p) => p.auth !== false)) {
        await def.run(page, { user });
        await settle(page, 800);
      }
      await context.close();
    }

    for (const mode of MODES) {
      for (const def of pages) {
        let bufs = [];
        let round = 0;
        while (round < ROUNDS) {
          round++;
          bufs = [];
          for (const variant of variants) {
            // A fresh context per shot: no focus, scroll or storage state carries from one shot
            // (or one variant) into the next.
            const context = await newContext(browser, {
              dist: variant.dist,
              lang,
              mode,
              fixedNow,
              reducedMotion: def.reducedMotion === true,
              ...(def.auth === false ? {} : { user }),
            });
            const page = await context.newPage();
            await def.run(page, { user });
            await settle(page);
            bufs.push(await stableScreenshot(page, `${variant.name}/${lang}/${mode}/${def.id}`));
            await context.close();
          }
          if (bufs.every((b) => b.equals(bufs[0]))) break;
        }
        for (const [i, variant] of variants.entries()) {
          const file = path.join(out, variant.name, lang, mode, `${def.id}.png`);
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, bufs[i]);
          shots++;
        }
        if (round > 1) console.log(`[theme-shots] ${lang} ${mode} ${def.id}: ${round} rounds`);
      }
      console.log(`[theme-shots] ${lang} ${mode}: ${pages.length} pages × ${variants.length}`);
    }
  }

  await browser.close();
  cleanup();
  console.log(`[theme-shots] ${shots} shots -> ${out}`);
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

function listPngs(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listPngs(path.join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith(".png")
        ? [`${prefix}${e.name}`]
        : [],
  );
}

async function diff(args) {
  const [a, b] = args.filter((x) => !x.startsWith("--")).map((d) => path.resolve(d));
  if (!a || !b) throw new Error("diff needs <dirA> <dirB>");
  const outIdx = args.indexOf("--diff-out");
  const diffOut = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(path.dirname(b), "diff");
  const left = new Set(listPngs(a));
  const right = new Set(listPngs(b));
  const names = [...new Set([...left, ...right])].sort();
  let browser;
  let page;
  const failures = [];
  for (const name of names) {
    if (!left.has(name) || !right.has(name)) {
      failures.push(`${name}: missing on the ${left.has(name) ? "right" : "left"}`);
      continue;
    }
    const bufA = readFileSync(path.join(a, name));
    const bufB = readFileSync(path.join(b, name));
    if (bufA.equals(bufB)) continue;
    browser ??= await chromium.launch();
    page ??= await browser.newPage();
    const result = await page.evaluate(
      async ([pa, pb]) => {
        const load = async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return {
            w: img.width,
            h: img.height,
            ctx,
            data: ctx.getImageData(0, 0, c.width, c.height),
          };
        };
        const x = await load(pa);
        const y = await load(pb);
        if (x.w !== y.w || x.h !== y.h) return { sizeMismatch: `${x.w}x${x.h} vs ${y.w}x${y.h}` };
        const out = x.ctx.createImageData(x.w, x.h);
        let count = 0;
        for (let i = 0; i < x.data.data.length; i += 4) {
          const same =
            x.data.data[i] === y.data.data[i] &&
            x.data.data[i + 1] === y.data.data[i + 1] &&
            x.data.data[i + 2] === y.data.data[i + 2] &&
            x.data.data[i + 3] === y.data.data[i + 3];
          if (same) {
            const g = (x.data.data[i] + x.data.data[i + 1] + x.data.data[i + 2]) / 3;
            out.data.set([g, g, g, 60], i);
          } else {
            count++;
            out.data.set([255, 0, 0, 255], i);
          }
        }
        if (count === 0) return { count };
        const c = document.createElement("canvas");
        c.width = x.w;
        c.height = x.h;
        c.getContext("2d").putImageData(out, 0, 0);
        return { count, png: c.toDataURL("image/png").split(",")[1] };
      },
      [bufA.toString("base64"), bufB.toString("base64")],
    );
    if (result.sizeMismatch) {
      failures.push(`${name}: size ${result.sizeMismatch}`);
    } else if (result.count > 0) {
      const file = path.join(diffOut, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(result.png, "base64"));
      failures.push(`${name}: ${result.count} px differ -> ${file}`);
    }
  }
  await browser?.close();
  console.log(`[theme-shots] compared ${names.length} shots: ${failures.length} differ`);
  for (const f of failures) console.log(`  ${f}`);
  return failures.length === 0;
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "capture") {
    await capture(rest);
    process.exit(0);
  } else if (command === "diff") {
    process.exit((await diff(rest)) ? 0 : 1);
  } else {
    console.error("usage: theme-shots.mjs capture --out <dir> <name>=<dist>… | diff <dirA> <dirB>");
    process.exit(2);
  }
} catch (err) {
  console.error("[theme-shots] FAILED:", err);
  process.exit(1);
}
