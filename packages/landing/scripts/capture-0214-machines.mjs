/**
 * Capture the 0.2.14 screenshots of remote machines: the Machines page with a machine
 * connected, the Add machine dialog, an install in progress, the Machine dialog, the
 * Workspace finder's machine list and a conversation that ran on the machine.
 *
 * Nothing is mocked except the model. The machine is real: an ssh host this server reaches
 * with a key (the release shots used a Debian container running sshd, user `penguin`,
 * aliased `devbox`). The server is the built one from this checkout, so it builds its own
 * install image at the first install; the machine downloads release VERSION itself and the
 * image goes over ssh. The mock model must be reachable from the machine as well, since the
 * machine's own server drives the conversation there.
 *
 * Two modes, because an install takes minutes and is done once:
 *
 *   node scripts/capture-0214-machines.mjs serve   # mock model + server, stays up
 *   node scripts/capture-0214-machines.mjs shots   # drives the running server
 *
 * Env:
 *   SHOT_SCRATCH       scratch root: out/ (PNGs), debug/, and data/ unless SHOT_DATA_ROOT
 *   SHOT_DATA_ROOT     the server's data root, shown on this server's card (default
 *                      $SHOT_SCRATCH/data; the release shots bind-mounted a scratch directory
 *                      on /srv in a user namespace so no home directory shows)
 *   SHOT_MACHINE_HOST  the machine's address (required for `shots`)
 *   SHOT_MACHINE_USER  its ssh user (default penguin)
 *   SHOT_MACHINE_ALIAS the name to add it under (default devbox)
 *   SHOT_MOCK_HOST     the address the mock model listens on and machines call (default
 *                      127.0.0.1; a container reaches its host on the bridge address)
 *   SRV_PORT, MOCK_PORT (19130, 19131), SHOT_FONTCONFIG, SHOT_ONLY (stages: add, page, chat)
 *
 * OpenSSH reads its config from the passwd home, not $HOME: put an `ssh` on PATH that passes
 * `-F "$HOME/.ssh/config"` (and the known_hosts and key under $HOME) before `serve`.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODE = process.argv[2] ?? "shots";
const SCRATCH = process.env.SHOT_SCRATCH ?? path.join(ROOT, ".shots-0214-machines");
const OUT_DIR = path.join(SCRATCH, "out");
const SRV_PORT = Number(process.env.SRV_PORT ?? 19130);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 19131);
const MOCK_HOST = process.env.SHOT_MOCK_HOST ?? "127.0.0.1";
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://${MOCK_HOST}:${MOCK_PORT}`;
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-machines-2026";
const MACHINE = {
  alias: process.env.SHOT_MACHINE_ALIAS ?? "devbox",
  host: process.env.SHOT_MACHINE_HOST ?? "",
  user: process.env.SHOT_MACHINE_USER ?? "penguin",
};
const WORKSPACE = "~/projects/etl";
/** The build this checkout installs, as the API reports it, and what the shots show instead. */
const SHOWN_VERSION = /0\.2\.13(?:\+hmr\.[0-9a-f]+)?/g;
const DISPLAY_VERSION = "0.2.14";
const ONLY = new Set((process.env.SHOT_ONLY ?? "").split(",").filter(Boolean));
const stage = (name) => ONLY.size === 0 || ONLY.has(name);

// ---------------------------------------------------------------------------
// The conversation that runs on the machine (en + zh). The command really runs there.
// ---------------------------------------------------------------------------

const CHECK_CMD = "hostname && ./scripts/export-check.sh";

const SCENES = {
  en: {
    prompt:
      "Which machine are you on? Run the export check in this workspace and tell me whether tonight's export is safe to ship.",
    title: "Nightly export check",
    lead: "Checking which host this is, then running the export check.",
    description: "Show the host name and run the export check",
    answer:
      "I'm on **devbox**, in `~/projects/etl`. The check found one problem: `refunds.csv` has two rows without an `order_id` (lines 88 and 131). `orders.csv` and `customers.csv` pass.\n\nDon't ship tonight's export until those two refunds are fixed or dropped.",
  },
  zh: {
    prompt: "你现在在哪台机器上？在这个工作区跑一下导出检查，告诉我今晚的导出能不能发。",
    title: "夜间导出检查",
    lead: "先确认所在主机，再运行导出检查。",
    description: "查看主机名并运行导出检查",
    answer:
      "我在 **devbox** 上，工作区是 `~/projects/etl`。检查发现一个问题：`refunds.csv` 有两行缺少 `order_id`（第 88 行和第 131 行）；`orders.csv` 和 `customers.csv` 都通过了。\n\n这两条退款修好或剔除之前，今晚的导出先别发。",
  },
};

// ---------------------------------------------------------------------------
// Mock model: OpenAI chat-completions SSE.
// ---------------------------------------------------------------------------

function decideTurn(messages) {
  const flat = JSON.stringify(messages);
  const toolResults = messages.filter((m) => m.role === "tool").length;
  if (flat.includes("You are a title generator")) {
    for (const lang of ["en", "zh"]) {
      if (flat.includes(SCENES[lang].prompt)) return { title: SCENES[lang].title };
    }
    return { title: "Conversation" };
  }
  for (const lang of ["en", "zh"]) {
    const scene = SCENES[lang];
    if (!flat.includes(scene.prompt)) continue;
    if (toolResults === 0) {
      return {
        text: scene.lead,
        call: { name: "exec_command", args: { description: scene.description, cmd: CHECK_CMD } },
      };
    }
    return { text: scene.answer };
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
    const prompt = 1800 + 400 * messages.length;
    chunk({}, reason, {
      prompt_tokens: prompt,
      completion_tokens: 160,
      total_tokens: prompt + 160,
      prompt_cache_hit_tokens: prompt - 600,
      prompt_cache_miss_tokens: 600,
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
  for (const part of turn.text.match(/[\s\S]{1,24}/g) ?? []) chunk({ content: part });
  if (turn.call) {
    chunk({
      tool_calls: [
        {
          index: 0,
          id: `call_shot_${Date.now()}`,
          type: "function",
          function: { name: turn.call.name, arguments: "" },
        },
      ],
    });
    for (const part of JSON.stringify(turn.call.args).match(/[\s\S]{1,32}/g) ?? []) {
      chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] });
    }
    done("tool_calls");
    return;
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
      if (req.url?.includes("chat/completions")) return openaiReply(res, json);
      console.log(`[mock] unexpected path ${req.url}`);
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, MOCK_HOST, () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Server and API helpers.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function serve() {
  const dataRoot = process.env.SHOT_DATA_ROOT ?? path.join(SCRATCH, "data");
  mkdirSync(dataRoot, { recursive: true });
  const mock = await startMock();
  console.log(`[machines] mock model on ${MOCK}`);
  const srv = spawn("node", [path.join(ROOT, "packages/server/dist/index.js")], {
    env: {
      ...process.env,
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
    console.log(`[machines] server exited ${code}`);
    process.exit(1);
  });
  await waitFor(`${BASE}/`);
  // The admin is seeded just after the server starts answering; rotate its password once.
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
  console.log(`[machines] server ready on ${BASE}, project ${projectId}`);
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Shots.
// ---------------------------------------------------------------------------

const LANGS = ["en", "zh"];
/** The UI words the flow clicks, per language (verbatim from the web dictionaries). */
const UI = {
  en: {
    add: "Add machine",
    manual: "Fill in by hand",
    submit: "Add",
    newChat: "New chat",
    choose: "Choose",
  },
  zh: { add: "添加机器", manual: "手动填写", submit: "添加", newChat: "新建对话", choose: "选择" },
};

async function machinesState(cookie, projectId) {
  return (await api(cookie, "GET", `/api/projects/${projectId}/machines`)).json;
}

const connected = (m) => m !== undefined && m.connection !== null && m.status?.state === "running";

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

  async function openPage(lang, url, viewport = { width: 1440, height: 900 }) {
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
    // Display only. This checkout's VERSION is still 0.2.13 (the bump lands with the release
    // tag), so the build it installs reports `0.2.13+hmr.<sha>`, while the posts these shots
    // illustrate announce 0.2.14. The version strings in the JSON the page reads (the machines
    // list, which the cards and the Machine dialog draw from, and /api/version) are rewritten
    // to `0.2.14` on their way to the browser. Nothing on the server or the machine changes,
    // and SSE streams are never routed.
    await context.route(
      (url) =>
        /\/api\/projects\/[^/]+\/machines(\/probe)?$/.test(url.pathname) ||
        /\/api\/version$/.test(url.pathname),
      async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace(SHOWN_VERSION, DISPLAY_VERSION);
        await route.fulfill({ response, body });
      },
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

  /** An element's box grown by `pad` CSS pixels, kept inside the viewport. */
  async function clipAround(page, locators, pad = 16) {
    const boxes = [];
    for (const l of locators) boxes.push(await l.boundingBox());
    const vp = page.viewportSize();
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
    const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  async function save(page, name, clip) {
    const file = path.join(OUT_DIR, name);
    await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
    console.log(`[machines] ${name}`);
  }

  async function debug(page, tag) {
    const dir = path.join(SCRATCH, "debug");
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${tag}.png`) }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    writeFileSync(path.join(dir, `${tag}.txt`), text);
  }

  async function closeAll() {
    for (const { page } of pages.splice(0)) await page.context().close();
  }

  try {
    // ---- Add machine: the dialog, then the install as it runs, until connected ----------
    let machine = (await machinesState(cookie, projectId)).machines.find(
      (m) => m.alias === MACHINE.alias,
    );
    if (stage("add") && machine === undefined) {
      if (MACHINE.host === "") throw new Error("SHOT_MACHINE_HOST is required to add a machine");
      const byLang = {};
      for (const lang of LANGS) {
        const page = await openPage(lang, "/machines");
        byLang[lang] = page;
        await page.locator('[data-action="add-machine"]').waitFor({ timeout: 30000 });
        await page.locator('[data-action="add-machine"]').click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("tab", { name: UI[lang].manual }).click();
        await dialog.locator('[data-field="alias"]').fill(MACHINE.alias);
        await dialog.locator('[data-field="hostName"]').fill(MACHINE.host);
        await dialog.locator('[data-field="user"]').fill(MACHINE.user);
        await page.waitForTimeout(600);
        await save(page, `machines-add-dialog-${lang}.png`, await clipAround(page, [dialog], 0));
      }
      // Add in one window; the other follows the same machine on its own list.
      await byLang.en.getByRole("dialog").locator('[data-action="add"]').click();
      await byLang.zh.goto(`${BASE}/machines`, { waitUntil: "domcontentloaded" });
      // The install as it runs: shot once the stepper is past the image build.
      let shotInstalling = false;
      for (let i = 0; i < 900; i++) {
        const state = await machinesState(cookie, projectId);
        machine = state.machines.find((m) => m.alias === MACHINE.alias);
        const job = state.jobs.find((j) => j.machineId === machine?.id && (j.running || j.queued));
        if (!shotInstalling && job?.phase === "install") {
          for (const lang of LANGS) {
            const page = byLang[lang];
            const card = page.locator(`[data-machine="${machine.id}"]`);
            await card.waitFor({ timeout: 10000 });
            await page.waitForTimeout(800);
            await save(page, `machines-installing-${lang}.png`, await clipAround(page, [card]));
          }
          shotInstalling = true;
        }
        if (connected(machine) && job === undefined) break;
        if (i % 10 === 0) console.log(`[machines] waiting: ${job?.phase ?? "no job"}`);
        await sleep(2000);
      }
      if (!connected(machine)) {
        for (const lang of LANGS) await debug(byLang[lang], `install-${lang}`);
        throw new Error(`${MACHINE.alias} did not connect`);
      }
      await closeAll();
    }
    if (!connected(machine)) throw new Error(`${MACHINE.alias} is not connected`);

    // ---- The Machines page, and the Machine dialog -------------------------------------
    if (stage("page")) {
      for (const lang of LANGS) {
        const page = await openPage(lang, "/machines", { width: 1280, height: 640 });
        const card = page.locator(`[data-machine="${machine.id}"]`);
        await card.waitFor({ timeout: 30000 });
        await page.waitForTimeout(1500);
        // The page from its title to the last card, beside the sidebar it is reached from.
        const box = await card.boundingBox();
        await save(page, `machines-page-${lang}.png`, {
          x: 0,
          y: 0,
          width: 1280,
          height: Math.min(640, Math.ceil(box.y + box.height + 40)),
        });
        // A taller window, so the dialog's rounded corners sit over empty page, not the cards.
        await page.setViewportSize({ width: 1280, height: 1000 });
        await card.getByRole("button", { name: MACHINE.alias }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ timeout: 10000 });
        await page.mouse.move(5, 5);
        await page.waitForTimeout(1200);
        await save(page, `machines-detail-${lang}.png`, await clipAround(page, [dialog], -3));
      }
      await closeAll();
    }

    // ---- A conversation in a workspace on the machine ----------------------------------
    if (stage("chat")) {
      // A rerun starts over: the conversations an earlier run left on the machine go first.
      const listed = await api(
        cookie,
        "GET",
        `/server/${machine.machineId}/api/projects/${projectId}/agents/default_agent/sessions`,
      );
      const titles = new Set(LANGS.map((l) => SCENES[l].title));
      for (const row of listed.json.sessions ?? []) {
        if (titles.has(row.title)) {
          await api(cookie, "DELETE", `/server/${machine.machineId}/api/sessions/${row.sessionId}`);
        }
      }
      for (const lang of LANGS) {
        const scene = SCENES[lang];
        const page = await openPage(lang, "/agents");
        await page.getByText(UI[lang].newChat, { exact: true }).first().click();
        const picker = page.getByRole("button", { name: /^(Workspace|工作区)$/ }).first();
        await picker.waitFor({ timeout: 30000 });
        if (
          await page
            .getByRole("dialog")
            .isVisible()
            .catch(() => false)
        ) {
          await page.keyboard.press("Escape");
        }
        await picker.click();
        const finder = page.getByRole("dialog");
        await finder.waitFor({ timeout: 10000 });
        await finder
          .getByRole("button", { name: new RegExp(`^${MACHINE.alias}`) })
          .first()
          .click();
        await page.waitForTimeout(1500);
        await debug(page, `finder-machine-${lang}`);
        await finder.locator('[data-finder-path$="/projects"]').first().dblclick();
        await page.waitForTimeout(1200);
        await finder.locator('[data-finder-path$="/etl"]').first().click();
        await page.mouse.move(5, 5);
        await page.waitForTimeout(800);
        await save(page, `machines-workspace-${lang}.png`, await clipAround(page, [finder], 0));
        await finder.getByRole("button", { name: UI[lang].choose, exact: true }).click();
        await page.waitForTimeout(1500);
        await debug(page, `composer-${lang}`);
        const input = page.locator("textarea").first();
        await input.fill(scene.prompt);
        await input.press("Enter");
        await page.getByText("refunds.csv", { exact: false }).last().waitFor({ timeout: 90000 });
        await page.waitForTimeout(2500);
        // Unfold the finished step so the command and what it printed on the machine show.
        await page
          .getByText(/^(Done|运行完毕)$/)
          .first()
          .click();
        await page.waitForTimeout(800);
        await page.getByText(scene.description, { exact: true }).first().click();
        await page.getByText("[check] refunds.csv").first().waitFor({ timeout: 10000 });
        await page.mouse.move(5, 5);
        await page.waitForTimeout(1200);
        // The window down to the answer: the sidebar's `etl [SSH: devbox]` group, the command
        // and what it printed on devbox, and the reply.
        await save(page, `penguinharness-0-2-14-machines-${lang}.png`, {
          x: 0,
          y: 0,
          width: 1440,
          height: 640,
        });
        // Each language's sidebar shows its own conversation only.
        const sessionId = new URL(page.url()).pathname.split("/").pop();
        await api(cookie, "DELETE", `/server/${machine.machineId}/api/sessions/${sessionId}`);
      }
      await closeAll();
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
