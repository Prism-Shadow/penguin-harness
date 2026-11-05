/**
 * Capture the 0.2.14 browser screenshots from the real desktop app: the built-in browser's
 * dock panel beside a conversation whose agent drives it with `penguin browser`, the new-tab
 * start page, and the Connect your Chrome pairing flow with the PenguinHarness Browser
 * extension loaded into Playwright's Chromium.
 *
 * The desktop shell runs unpackaged (dev profile) on Electron under Xvfb, driven through
 * Playwright's `_electron`; its embedded server runs on a scratch PENGUIN_HOME, and the agent
 * talks to a scripted mock LLM (OpenAI chat-completions SSE). The agent's commands really run:
 * `penguin browser open` loads a public page in the built-in browser's <webview>, and the final
 * answer is written from what `penguin browser exec` returned, so the reply matches the page.
 *
 * Env (all required unless noted):
 *   SHOT_ELECTRON  Electron binary matching packages/desktop's electron version
 *   SHOT_SCRATCH   scratch directory (data roots, Workspaces, Electron userData)
 *   SHOT_OUT       output directory for the PNGs
 *   SHOT_LANGS     optional, "en,zh" by default
 *   SHOT_PHASES    optional, "main,start,pair,chrome" by default
 *   SHOT_MOCK_PORT optional, 19111 by default
 *
 * Run under a display: `xvfb-run -a -s "-screen 0 3400x2200x24" node scripts/capture-0214-browser.mjs`.
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SCRATCH = process.env.SHOT_SCRATCH;
const ELECTRON = process.env.SHOT_ELECTRON;
const OUT = process.env.SHOT_OUT;
const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");
const PHASES = new Set((process.env.SHOT_PHASES ?? "main,start,pair,chrome").split(","));
const MOCK_PORT = Number(process.env.SHOT_MOCK_PORT ?? 19111);
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const TARGET = "https://penguin.ooo/blog";
const EXTENSION_DIR = path.join(ROOT, "packages/browser-extension/dist");
const WIDTH = 1440;
const CHROME_W = 1280;
const CHROME_H = 800;
const HEIGHT = 1000;

const EXTRACT = `const posts = [...document.querySelectorAll('a:has(h2)')].map((a) => ({
  date: a.querySelector('time')?.getAttribute('datetime'),
  title: a.querySelector('h2')?.innerText.trim(),
}));
posts.sort((a, b) => b.date.localeCompare(a.date));
return JSON.stringify(posts.slice(0, 3));`;

const SCENES = {
  en: {
    prompt: "Open the PenguinHarness blog and list the three newest posts with their dates.",
    title: "Newest PenguinHarness posts",
    steps: [
      {
        text: "I'll do this in the built-in browser.",
        description: "Check the browser",
        exec: "penguin browser status",
      },
      { description: "Open the blog", exec: `penguin browser open ${TARGET}` },
      { description: "Read the page", exec: "penguin browser scan" },
      {
        description: "Get each post's date and title, newest first",
        exec: `penguin browser exec <<'EOF'\n${EXTRACT}\nEOF`,
      },
    ],
    answer: (posts) =>
      [
        "The three newest posts on the PenguinHarness blog:",
        "",
        ...posts.map((p, i) => `${i + 1}. **${p.title}** (${p.date})`),
        "",
        "The page is still open in the Browser panel.",
      ].join("\n"),
  },
  zh: {
    prompt: "打开 PenguinHarness 博客，列出最新的三篇文章和发布日期。",
    title: "博客最新文章",
    steps: [
      { text: "我用内置浏览器来做。", description: "检查浏览器", exec: "penguin browser status" },
      { description: "打开博客", exec: `penguin browser open ${TARGET}` },
      { description: "读取页面", exec: "penguin browser scan" },
      {
        description: "按日期从新到旧取出每篇文章的日期和标题",
        exec: `penguin browser exec <<'EOF'\n${EXTRACT}\nEOF`,
      },
    ],
    answer: (posts) =>
      [
        "PenguinHarness 博客最新的三篇文章：",
        "",
        ...posts.map((p, i) => `${i + 1}. **${p.title}**（${p.date}）`),
        "",
        "页面还开在浏览器面板里。",
      ].join("\n"),
  },
};

const DOCS = "https://penguin.ooo/docs/builtin-browser/";
const SECTIONS = `for (let i = 0; i < 20 && !document.querySelector('h3'); i++) {
  await new Promise((r) => setTimeout(r, 250));
}
return JSON.stringify([...document.querySelectorAll('h3')].map((h) => h.innerText.trim()));`;

/** The same agent, after the user switched it to their own Chrome. */
const CHROME_SCENES = {
  en: {
    prompt:
      "Open the PenguinHarness docs page about the built-in browser and list what it covers about using my own Chrome.",
    title: "Docs: using your own Chrome",
    again: "The page reloaded under the script; run it again",
    steps: [
      {
        text: "I'll look it up in your Chrome.",
        description: "Check the browser",
        exec: "penguin browser status",
      },
      { description: "Open the Built-in Browser docs", exec: `penguin browser open ${DOCS}` },
      { description: "Read the page as text", exec: "penguin browser scan --text" },
      {
        description: "List the page's subsections",
        exec: `penguin browser exec <<'EOF'\n${SECTIONS}\nEOF`,
      },
    ],
    answer: (items) =>
      [
        "The page's **Use your own Chrome** part covers:",
        "",
        ...items.map((t, i) => `${i + 1}. ${t}`),
        "",
        "The tab is in your Chrome's Penguin group.",
      ].join("\n"),
  },
  zh: {
    prompt:
      "打开 PenguinHarness 文档里讲内置浏览器的那一页，列出关于使用我自己的 Chrome 都讲了哪些内容。",
    title: "文档：使用自己的 Chrome",
    again: "脚本运行时页面刷新了，再运行一次",
    steps: [
      { text: "我在你的 Chrome 里查。", description: "检查浏览器", exec: "penguin browser status" },
      { description: "打开内置浏览器文档", exec: `penguin browser open ${DOCS}` },
      { description: "以文本读取页面", exec: "penguin browser scan --text" },
      {
        description: "列出页面的小节",
        exec: `penguin browser exec <<'EOF'\n${SECTIONS}\nEOF`,
      },
    ],
    answer: (items) =>
      [
        "这一页关于使用自己的 Chrome 讲了这些：",
        "",
        ...items.map((t, i) => `${i + 1}. ${t}`),
        "",
        "标签页在你 Chrome 的 Penguin 分组里。",
      ].join("\n"),
  },
};

// ---------------------------------------------------------------------------
// Mock LLM (OpenAI chat-completions SSE).
// ---------------------------------------------------------------------------

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? "").join("");
  return "";
}

function decideTurn(body) {
  const messages = body.messages ?? [];
  const flat = JSON.stringify(messages);
  for (const lang of ["en", "zh"]) {
    const scene = CHROME_SCENES[lang];
    if (!flat.includes(scene.prompt)) continue;
    if (flat.includes("You are a title generator")) return { title: scene.title };
    const tools = messages.filter((m) => m.role === "tool");
    if (tools.length < scene.steps.length) return scene.steps[tools.length];
    const last = textOf(tools.at(-1).content);
    let items = [];
    try {
      items = JSON.parse(/(\[".*?"\])/s.exec(last)?.[1] ?? "[]");
    } catch {}
    if (items.length === 0 && /reloaded/.test(last) && tools.length === scene.steps.length) {
      // The page navigated under the script (the skill's rule: run it again on the new page).
      return { ...scene.steps.at(-1), description: scene.again };
    }
    if (items.length === 0) {
      console.log("[mock] could not read sections from the exec result:", last.slice(0, 600));
      return { text: lang === "zh" ? "没有读到小节列表。" : "I could not read the sections." };
    }
    return { text: scene.answer(items) };
  }
  if (flat.includes("You are a title generator")) {
    const lang = flat.includes(SCENES.zh.prompt) ? "zh" : "en";
    return { title: SCENES[lang].title };
  }
  const lang = flat.includes(SCENES.zh.prompt)
    ? "zh"
    : flat.includes(SCENES.en.prompt)
      ? "en"
      : null;
  if (lang === null) return { text: "OK." };
  const scene = SCENES[lang];
  const tools = messages.filter((m) => m.role === "tool");
  if (tools.length < scene.steps.length) return scene.steps[tools.length];
  const last = textOf(tools.at(-1).content);
  const match = /(\[\{.*?\}\])/s.exec(last);
  let posts = [];
  try {
    posts = JSON.parse(match?.[1] ?? "[]");
  } catch {}
  if (posts.length === 0) {
    console.log("[mock] could not read posts from the exec result:", last.slice(0, 600));
    return { text: lang === "zh" ? "没有读到文章列表。" : "I could not read the post list." };
  }
  return { text: scene.answer(posts) };
}

function openaiReply(res, body) {
  const turn = decideTurn(body);
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
  const usage = {
    prompt_tokens: 3200,
    completion_tokens: 120,
    total_tokens: 3320,
    prompt_cache_hit_tokens: 2800,
    prompt_cache_miss_tokens: 400,
  };
  chunk({ role: "assistant" });
  if (turn.title) {
    chunk({ content: turn.title });
    chunk({}, "stop", usage);
    res.end("data: [DONE]\n\n");
    return;
  }
  if (turn.text) for (const t of turn.text.match(/[\s\S]{1,24}/g) ?? []) chunk({ content: t });
  if (turn.exec) {
    // Real models send the schema's `description` first; the card's header shows it.
    const args = JSON.stringify({ description: turn.description, cmd: turn.exec });
    chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_shot_${Date.now()}`,
          type: "function",
          function: { name: "exec_command", arguments: "" },
        },
      ],
    });
    for (const part of args.match(/[\s\S]{1,32}/g) ?? [])
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    chunk({}, "tool_calls", usage);
  } else {
    chunk({}, "stop", usage);
  }
  res.end("data: [DONE]\n\n");
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
      if (req.method === "POST" && req.url?.includes("chat/completions")) {
        try {
          openaiReply(res, json);
        } catch (err) {
          console.error("[mock] reply error:", err);
          res.end();
        }
        return;
      }
      console.log(`[mock] unexpected ${req.method} ${req.url}`);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Desktop app.
// ---------------------------------------------------------------------------

/**
 * The gallery's font configuration, plus Noto Sans CJK SC ahead of the host's other CJK fonts:
 * the live pages the browser loads fall back to system fonts for Chinese, and without this a
 * simplified-only character lands in a Kai or Ming face, glyph by glyph.
 */
function fontsConf() {
  const file = path.join(SCRATCH, "fonts-cjk.conf");
  const gallery = path.join(ROOT, "packages/ui-gallery/scripts/fonts.conf");
  const prefer = "<prefer><family>Noto Sans</family><family>Noto Sans CJK SC</family></prefer>";
  writeFileSync(
    file,
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
      "<fontconfig>",
      `  <include ignore_missing="yes">${gallery}</include>`,
      '  <match target="pattern">',
      '    <test name="lang" compare="contains"><string>zh</string></test>',
      '    <edit name="family" mode="prepend" binding="strong"><string>Noto Sans CJK SC</string></edit>',
      "  </match>",
      `  <alias binding="strong"><family>sans-serif</family>${prefer}</alias>`,
      `  <alias binding="strong"><family>system-ui</family>${prefer}</alias>`,
      "</fontconfig>",
      "",
    ].join("\n"),
  );
  return file;
}

async function launchDesktop(lang) {
  const base = path.join(SCRATCH, `desktop-${lang}`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [
      "--no-sandbox",
      "--force-device-scale-factor=2",
      // Xvfb has no window manager to report the window as visible; keep Chromium from
      // treating it (and the <webview> guests in it) as backgrounded or occluded.
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      `--lang=${lang === "zh" ? "zh-CN" : "en-US"}`,
      ...(process.env.SHOT_EXTRA_ARGS ? process.env.SHOT_EXTRA_ARGS.split(" ") : []),
      path.join(ROOT, "packages/desktop"),
    ],
    env: {
      ...process.env,
      PENGUIN_HOME: path.join(base, "home"),
      XDG_CONFIG_HOME: path.join(base, "config"),
      PENGUIN_NO_LOGIN_SHELL_ENV: "1",
      FONTCONFIG_FILE: fontsConf(),
      LANG: "en_US.UTF-8",
      // The UI language Chromium reports to pages (navigator.language) follows LANGUAGE.
      LANGUAGE: lang === "zh" ? "zh_CN:zh" : "en_US:en",
      // UTC keeps the message times on the post's date (2026-10-12) for an evening capture.
      TZ: "UTC",
    },
    timeout: 90000,
  });
  app.process().stderr.on("data", (d) => {
    const s = String(d);
    if (/error|fail/i.test(s)) process.stdout.write(`[app!] ${s}`);
  });
  const win = await app.firstWindow({ timeout: 90000 });
  await win.waitForURL(/\/(chat|projects|$)/, { timeout: 60000 }).catch(() => {});
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const bw = BrowserWindow.getAllWindows()[0];
      bw.setContentSize(w, h);
    },
    [WIDTH, HEIGHT],
  );
  const origin = new URL(win.url()).origin;
  console.log(`[${lang}] desktop window on ${origin}`);
  return { app, win, base, origin };
}

/** A same-origin API call from the window (its session cookie signs it in). */
async function api(win, method, url, body) {
  const res = await win.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u, {
        method: m,
        headers: { "content-type": "application/json" },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      return { status: r.status, text: await r.text() };
    },
    [method, url, body],
  );
  if (res.status >= 400) throw new Error(`${method} ${url} -> ${res.status} ${res.text}`);
  try {
    return JSON.parse(res.text);
  } catch {
    return {};
  }
}

async function setPrefs(win, lang, extra = {}) {
  await win.evaluate(
    ([l, more]) => {
      localStorage.setItem("penguin.lang", l);
      localStorage.setItem("penguin.themeId", "modern");
      localStorage.setItem("penguin.theme", "light");
      localStorage.setItem("penguin.lastProjectId", "default_project");
      localStorage.setItem("penguin.panelWidth", "720");
      localStorage.setItem("penguin.sidebarCollapsed", "1");
      for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
    },
    [lang, extra],
  );
}

async function capture(app, win, file, clip) {
  // Under Xvfb a guest brought on screen keeps showing the frame it last painted at its parked
  // size until something repaints it; ask every guest for a fresh frame first.
  await app.evaluate(({ webContents }) => {
    for (const w of webContents.getAllWebContents()) if (w.getType() === "webview") w.invalidate();
  });
  await win.waitForTimeout(1200);
  // The window's own capture: it composites the <webview> guests with the page.
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return img.toPNG().toString("base64");
  });
  const full = path.join(OUT, `raw-${file}`);
  writeFileSync(full, Buffer.from(b64, "base64"));
  if (clip) writeFileSync(path.join(OUT, `${file}.clip.json`), JSON.stringify(clip));
  console.log(`[shot] ${file}${clip ? ` clip ${JSON.stringify(clip)}` : ""}`);
}

async function boxOf(locator, pad = 0) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no bounding box");
  return {
    x: Math.max(0, Math.round(b.x - pad)),
    y: Math.max(0, Math.round(b.y - pad)),
    width: Math.round(b.width + 2 * pad),
    height: Math.round(b.height + 2 * pad),
  };
}

async function dump(win, tag) {
  try {
    writeFileSync(path.join(OUT, `debug-${tag}.png`), await win.screenshot());
    writeFileSync(
      path.join(OUT, `debug-${tag}.txt`),
      await win.evaluate(() => {
        const btns = [...document.querySelectorAll("button")].map(
          (b) =>
            b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent?.slice(0, 40),
        );
        return `${document.body.innerText}\n---buttons---\n${JSON.stringify(btns)}`;
      }),
    );
  } catch {}
}

// ---------------------------------------------------------------------------
// Scenes.
// ---------------------------------------------------------------------------

/** Settings › Browser, Connect your Chrome, and the extension's own pairing page in Chromium. */
async function pairChrome(app, win, lang, base) {
  const T =
    lang === "zh"
      ? {
          settings: "设置",
          browser: "浏览器",
          connect: /连接你的 Chrome/,
          waiting: /等待 Chrome/,
          connected: "已连接",
          another: /连接另一个 Chrome/,
        }
      : {
          settings: "Settings",
          browser: "Browser",
          connect: /^Connect your Chrome$/,
          waiting: /Waiting for Chrome/,
          connected: "Connected",
          another: /Connect another Chrome/,
        };
  await win.getByRole("button", { name: "admin" }).first().click();
  await win.getByText(T.settings, { exact: true }).last().click();
  const dialog = win.getByRole("dialog").last();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: T.browser, exact: true }).first().click();
  await win.waitForTimeout(1200);
  await dump(win, `settings-${lang}`);

  await dialog.getByRole("button", { name: T.connect }).first().click();
  const pairing = win.getByRole("dialog").last();
  const codeEl = win.getByTestId("browser-pairing-code");
  await codeEl.waitFor({ timeout: 15000 });
  await win.getByText(T.waiting).first().waitFor({ timeout: 10000 });
  await win.waitForTimeout(800);
  const code = (await codeEl.innerText()).trim();
  const server = (await win.getByTestId("browser-pairing-server").innerText()).trim();
  console.log(`[${lang}] pairing ${server} with a ${code.length}-character code`);
  // Inset by 2px: the dialog's rounded corners would otherwise show the page behind.
  await capture(app, win, `browser-connect-chrome-${lang}.png`, await boxOf(pairing, -2));

  // Chromium with the unpacked PenguinHarness Browser extension, headed under the same Xvfb.
  const profile = path.join(base, "chromium-profile");
  // Chrome offers to translate a page whose markup says another language than its UI; the
  // bubble would cover the debugging bar in the window grab.
  mkdirSync(path.join(profile, "Default"), { recursive: true });
  writeFileSync(
    path.join(profile, "Default", "Preferences"),
    JSON.stringify({ translate: { enabled: false } }),
  );
  // A real window (no viewport emulation) at 2x, so an Xvfb grab shows Chrome's own tab strip.
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: null,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--force-device-scale-factor=2",
      "--window-position=0,0",
      `--window-size=${CHROME_W},${CHROME_H}`,
      `--lang=${lang === "zh" ? "zh-CN" : "en-US"}`,
      // No translate bubble over the page in the window grab.
      "--disable-features=Translate",
    ],
    env: {
      ...process.env,
      FONTCONFIG_FILE: fontsConf(),
      LANG: "en_US.UTF-8",
      // Chrome's own UI language (the debugging bar, menus) follows LANGUAGE.
      LANGUAGE: lang === "zh" ? "zh_CN:zh" : "en_US:en",
    },
  });
  try {
    let [worker] = ctx.serviceWorkers();
    if (!worker) worker = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
    const extId = new URL(worker.url()).host;
    console.log(`[${lang}] extension id ${extId}`);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`chrome-extension://${extId}/pages/pair.html`);
    await page.locator("#language button").first().waitFor({ timeout: 10000 });
    await page.locator(`#language button[data-language="${lang}"]`).click();
    await page.waitForTimeout(500);
    await page.locator("#server-url").fill(server);
    await page.locator("#code").fill(code);
    await page.waitForTimeout(300);
    await page.locator("#connect").click();
    // The app's dialog turns to Connected once the extension's socket is up.
    await win.getByText(T.connected, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    writeFileSync(
      path.join(OUT, `raw-browser-extension-pair-${lang}.png`),
      await page.locator("main.page").screenshot(),
    );
    console.log(`[shot] browser-extension-pair-${lang}.png`);
    // The dialog closes by itself; Settings › Browser now lists the paired Chrome.
    await win.waitForTimeout(3000);
    const settings = win.getByRole("dialog").last();
    await win.getByTestId("paired-chrome").first().waitFor({ timeout: 15000 });
    if (PHASES.has("chrome")) {
      // The step the tutorial shows: agents switched to the paired Chrome.
      await settings
        .getByRole("button", { name: lang === "zh" ? "系统 Chrome" : "System Chrome", exact: true })
        .click();
      await win
        .getByText(lang === "zh" ? "Agent 现在使用你的 Chrome" : "Agents now use your Chrome")
        .first()
        .waitFor({ timeout: 15000 });
    }
    await win.waitForTimeout(800);
    // The settings page's own pane: right of the rail, down to the Connect another Chrome button.
    // Inset past the dialog's corner radius so no backdrop shows at the clipped corner.
    const box = await boxOf(settings, -14);
    const rail = await boxOf(settings.locator("nav").first());
    const another = await boxOf(settings.getByRole("button", { name: T.another }));
    await capture(app, win, `browser-settings-${lang}.png`, {
      x: rail.x + rail.width,
      y: box.y,
      width: box.x + box.width - (rail.x + rail.width),
      height: another.y + another.height + 36 - box.y,
    });

    if (PHASES.has("chrome")) await driveChrome(app, win, lang, base, page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Agents switched to the user's Chrome: the same loop, with the page in Chrome's Penguin group. */
async function driveChrome(app, win, lang, base, pairPage) {
  const scene = CHROME_SCENES[lang];
  await win.keyboard.press("Escape");
  await win.waitForTimeout(800);
  // The pairing page stays open in Chrome; the agent's tab opens beside it in a group.
  await pairPage.bringToFront().catch(() => {});

  const ws = path.join(base, "ws", "blog-notes");
  const sess = await api(
    win,
    "POST",
    "/api/projects/default_project/agents/default_agent/sessions",
    {
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      approvalMode: "allow-all",
      workspace: ws,
    },
  );
  const sessionId = sess.session.sessionId;
  await win.goto(`${new URL(win.url()).origin}/chat/${sessionId}`);
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(2500);
  await api(win, "POST", `/api/sessions/${sessionId}/tasks`, {
    input: [{ type: "text", text: scene.prompt }],
  });
  const final = win.getByText(lang === "zh" ? "这一页关于使用自己的 Chrome" : "part covers:");
  await final.first().waitFor({ timeout: 180000 });
  await win.waitForTimeout(1500);
  const groups = win.getByRole("button", { name: /^(Done|运行完毕)\s*\d+\s*(steps?|步)/ });
  const n = await groups.count();
  for (let i = 0; i < n; i++) await groups.nth(i).click();
  await win.mouse.move(5, 5);
  await win.waitForTimeout(2000);
  await dump(win, `chrome-${lang}`);
  // Chrome first: its debugging bar goes away a minute after the agent's last command. The
  // pause lets the docs page's web fonts finish loading for the grab.
  await win.waitForTimeout(6000);
  try {
    execFileSync("xwd", ["-root", "-silent", "-out", path.join(OUT, `chrome-window-${lang}.xwd`)]);
    writeFileSync(
      path.join(OUT, `chrome-window-${lang}.json`),
      JSON.stringify({ x: 0, y: 0, width: CHROME_W * 2, height: CHROME_H * 2 }),
    );
    console.log(`[shot] chrome-window-${lang}.xwd`);
  } catch (err) {
    console.log(`[warn] xwd failed: ${err}`);
  }
  await capture(app, win, `browser-chrome-panel-${lang}.png`);
}

async function runLanguage(lang) {
  const scene = SCENES[lang];
  const { app, win, base } = await launchDesktop(lang);
  try {
    await setPrefs(win, lang);
    await api(win, "PUT", "/api/projects/default_project/models", {
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
    const ws = path.join(base, "ws", lang === "zh" ? "blog-notes" : "blog-notes");
    mkdirSync(ws, { recursive: true });
    const sess = await api(
      win,
      "POST",
      "/api/projects/default_project/agents/default_agent/sessions",
      {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        approvalMode: "allow-all",
        workspace: ws,
      },
    );
    const sessionId = sess.session.sessionId;
    await win.goto(`${new URL(win.url()).origin}/chat/${sessionId}`);
    await win.waitForLoadState("domcontentloaded");
    await win.keyboard.press("Escape").catch(() => {});
    await win.waitForTimeout(2500);

    if (PHASES.has("main")) {
      await api(win, "POST", `/api/sessions/${sessionId}/tasks`, {
        input: [{ type: "text", text: scene.prompt }],
      });
      // The final answer carries the first post's number marker; wait for it to land.
      const final = win.getByText(lang === "zh" ? "最新的三篇文章：" : "The three newest posts on");
      await final.first().waitFor({ timeout: 180000 });
      await win.waitForTimeout(2000);
      // The steps fold into one "Done · 4 steps" group; unfold it, then open the card of the
      // page opening, whose arguments and output show `penguin browser open` at work.
      const groups = win.getByRole("button", { name: /^(Done|运行完毕)\s*\d+\s*(steps?|步)/ });
      const n = await groups.count();
      for (let i = 0; i < n; i++) await groups.nth(i).click();
      await win.waitForTimeout(600);
      for (const step of [scene.steps[1]]) {
        await win
          .getByRole("button", {
            name: new RegExp(step.description.replace(/[.*+?^${}()|[\]\\']/g, ".")),
          })
          .first()
          .click();
        await win.waitForTimeout(400);
      }
      await win.mouse.move(5, 5);
      await win.waitForTimeout(2500);
      await dump(win, `main-${lang}`);
      await capture(app, win, `penguinharness-0-2-14-browser-${lang}.png`);

      // The tutorial's variant: the status card open instead, naming the built-in backend.
      for (const step of [scene.steps[1], scene.steps[0]]) {
        await win
          .getByRole("button", { name: new RegExp(step.description) })
          .first()
          .click();
        await win.waitForTimeout(400);
      }
      await win.mouse.move(5, 5);
      await win.waitForTimeout(1500);
      await capture(app, win, `browser-panel-${lang}.png`);

      // The toolbar's menu on the page: import, clearing data, the homepage, the system
      // browser and the developer tools.
      const vp = await boxOf(win.getByTestId("builtin-browser-viewport"));
      await win
        .getByRole("button", { name: lang === "zh" ? "更多" : "More", exact: true })
        .last()
        .click();
      const menu = win.getByRole("menu").last();
      await menu.waitFor({ timeout: 10000 });
      await win.waitForTimeout(800);
      const m = await boxOf(menu, 0);
      await capture(app, win, `browser-menu-${lang}.png`, {
        x: vp.x,
        y: 50,
        width: vp.width,
        height: Math.min(vp.y + vp.height, m.y + m.height + 40) - 50,
      });
      await win.keyboard.press("Escape");
      await win.waitForTimeout(500);
    }

    if (PHASES.has("start")) {
      // A shorter window keeps the start page's tiles from floating in a tall empty panel.
      await app.evaluate(
        ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 640),
        WIDTH,
      );
      await win.waitForTimeout(800);
      const plus = win.getByTestId("builtin-browser-new-tab");
      await plus.waitFor({ timeout: 30000 });
      await plus.click();
      const startPage = win.getByTestId("builtin-browser-start-page");
      await startPage.waitFor({ timeout: 30000 });
      await win.mouse.move(5, 5);
      await win.waitForTimeout(1500);
      // The panel from its dock tab down.
      const viewport = await boxOf(win.getByTestId("builtin-browser-viewport"));
      const top = 50;
      await capture(app, win, `browser-start-page-${lang}.png`, {
        x: viewport.x,
        y: top,
        width: viewport.width,
        height: viewport.y + viewport.height - top,
      });

      await app.evaluate(
        ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
        [WIDTH, HEIGHT],
      );
      await win.waitForTimeout(800);
    }

    if (PHASES.has("pair")) await pairChrome(app, win, lang, base);
  } catch (err) {
    await dump(win, `fail-${lang}`);
    throw err;
  } finally {
    await app.close().catch(() => {});
  }
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(EXTENSION_DIR)) console.log(`[warn] no extension build at ${EXTENSION_DIR}`);
const mock = await startMock();
try {
  for (const lang of LANGS) await runLanguage(lang);
} finally {
  mock.close();
}
console.log("[done]");
process.exit(0);
