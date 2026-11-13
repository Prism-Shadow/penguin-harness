/**
 * Capture the 0.2.17 screenshot of a machine's Agents on the Agents page: this server's Agents
 * and the Agents of a connected machine in one list, each machine card named `[SSH: devbox]`
 * after the Agent's name.
 *
 *   penguinharness-0-2-17-machines-{en,zh}.png
 *
 * Nothing is mocked but the model. The machine is real: an ssh host this server reaches with a
 * key (the release shot used a Debian container running sshd, user `penguin`, aliased `devbox`).
 * The server is the built one from this checkout, so it builds its own install image at the
 * first install; the machine downloads this checkout's release version itself and the image goes
 * over ssh. The Agents on the machine are created there, through this server's machine proxy.
 *
 * Two modes, because an install takes minutes and is done once:
 *
 *   node scripts/capture-0217-machines.mjs serve   # mock model + server, installs devbox, stays up
 *   node scripts/capture-0217-machines.mjs shots   # drives the running server
 *
 * The server runs with HOME at $SHOT_SCRATCH/home, which holds the ssh key and the config this
 * server writes the host into. OpenSSH reads its config and known_hosts from the passwd home, not
 * $HOME, so `serve` puts wrappers for ssh and scp on the server's PATH that pass -F and
 * UserKnownHostsFile under $HOME: nothing in the account's real ~/.ssh is read or written.
 *
 * Env:
 *   SHOT_SCRATCH       scratch root: home/ (with .ssh/id_ed25519), bin/, data/, out/, debug/
 *   SHOT_MACHINE_HOST  the machine's address (default 127.0.0.1)
 *   SHOT_MACHINE_PORT  its ssh port (default 22)
 *   SHOT_MACHINE_USER  its ssh user (default penguin)
 *   SHOT_MACHINE_ALIAS the name to add it under (default devbox)
 *   SRV_PORT, MOCK_PORT (19219, 19220), SHOT_FONTCONFIG, SHOT_LANGS (en,zh), and for review
 *   only SHOT_DARK=1 (dark theme) and SHOT_HOVER=1 (a machine card hovered)
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODE = process.argv[2] ?? "shots";
const SCRATCH = process.env.SHOT_SCRATCH ?? path.join(ROOT, ".shots-0217-machines");
const OUT_DIR = path.join(SCRATCH, "out");
const HOME = path.join(SCRATCH, "home");
const SRV_PORT = Number(process.env.SRV_PORT ?? 19219);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 19220);
const BASE = `http://localhost:${SRV_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SEED_PASSWORD = "penguin-2026";
const ADMIN_PASSWORD = "penguin-machines-0217";
const MACHINE = {
  alias: process.env.SHOT_MACHINE_ALIAS ?? "devbox",
  host: process.env.SHOT_MACHINE_HOST ?? "127.0.0.1",
  port: Number(process.env.SHOT_MACHINE_PORT ?? 22),
  user: process.env.SHOT_MACHINE_USER ?? "penguin",
};
const DARK = process.env.SHOT_DARK === "1";
const HOVER = process.env.SHOT_HOVER === "1";
const SUFFIX = `${DARK ? "-dark" : ""}${HOVER ? "-hover" : ""}`;
const LANGS = (process.env.SHOT_LANGS ?? "en,zh").split(",");

// ---------------------------------------------------------------------------
// The Agents on each side, per language: the one a reader names is named in that language.
// ---------------------------------------------------------------------------

/**
 * Every Project's built-in Agents, on this server and on the machine alike: two servers' Agents
 * of one id are two cards. They keep the names the preset stores, in English, in either interface
 * language, as a reader sees them; each shot puts those names back.
 */
const BUILTIN_PRESETS = [
  {
    agentId: "default_agent",
    name: "General Agent",
    description: "General-purpose agent that completes the user's requests with its tools.",
  },
  {
    agentId: "penguin_support",
    name: "PenguinHarness Support",
    description:
      "Product support with questions, follow-ups and answers grounded in the official docs and source code.",
  },
];
const BUILTIN_AGENTS = BUILTIN_PRESETS.map(({ agentId, name, description }) => ({
  agentId,
  en: { name, description },
  zh: { name, description },
}));
/** An Agent only the machine has. */
const MACHINE_AGENTS = [
  {
    agentId: "etl_checker",
    en: {
      name: "ETL checker",
      description: "Checks the nightly export on this machine before it ships",
    },
    zh: { name: "ETL 检查", description: "在本机的夜间导出发出前检查数据" },
  },
];

// ---------------------------------------------------------------------------
// Mock model: OpenAI chat-completions SSE (nothing on this page talks to it; the Project still
// needs a model, and the machine is handed this Project's config).
// ---------------------------------------------------------------------------

function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.includes("chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunk = (delta, finish = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "chatcmpl-shot", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "deepseek-v4-pro", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      chunk({ role: "assistant" });
      chunk({ content: "OK." });
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
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

async function machinesState(cookie, projectId) {
  return (await api(cookie, "GET", `/api/projects/${projectId}/machines`)).json;
}

const connected = (m) => m !== undefined && m.connection !== null && m.status?.state === "running";

/** ssh and scp that read their config and known hosts under $HOME, not the passwd home. */
function writeSshWrappers() {
  const bin = path.join(SCRATCH, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(HOME, ".ssh"), { recursive: true, mode: 0o700 });
  const config = path.join(HOME, ".ssh", "config");
  if (!existsSync(config)) writeFileSync(config, "", { mode: 0o600 });
  for (const tool of ["ssh", "scp"]) {
    const file = path.join(bin, tool);
    writeFileSync(
      file,
      `#!/bin/sh\nexec /usr/bin/${tool} -F "$HOME/.ssh/config" -o UserKnownHostsFile="$HOME/.ssh/known_hosts" "$@"\n`,
    );
    chmodSync(file, 0o755);
  }
  return bin;
}

async function serve() {
  const dataRoot = path.join(SCRATCH, "data");
  mkdirSync(dataRoot, { recursive: true });
  const bin = writeSshWrappers();
  const mock = await startMock();
  console.log(`[machines] mock model on ${MOCK}`);
  const srv = spawn(process.execPath, [path.join(ROOT, "packages/server/dist/index.js")], {
    env: {
      ...process.env,
      HOME,
      PATH: `${bin}:${process.env.PATH}`,
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
  // The admin is seeded just after the server starts answering; rotate its password once, or a
  // banner covers the top of every shot.
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

  // A new Project holds every catalog preset; so does this one beside the mock's row, or the
  // Models entry carries a preset-update dot no fresh install shows.
  await api(cookie, "POST", `/api/projects/${projectId}/models/sync-presets`, { mode: "add" });

  // The machine: its host block, the install, and the connection it ends in.
  const base = `/api/projects/${projectId}/machines`;
  let machine = (await machinesState(cookie, projectId)).machines.find(
    (m) => m.alias === MACHINE.alias,
  );
  if (machine === undefined) {
    const added = await api(cookie, "POST", `${base}/ssh-hosts`, {
      alias: MACHINE.alias,
      hostName: MACHINE.host,
      user: MACHINE.user,
      port: MACHINE.port,
      identityFile: path.join(HOME, ".ssh", "id_ed25519"),
    });
    machine = added.json.machines.find((m) => m.alias === MACHINE.alias);
  }
  if (!connected(machine)) {
    await api(cookie, "POST", `${base}/${encodeURIComponent(machine.id)}/install`, {});
    let lastPhase = "";
    for (let i = 0; i < 900; i++) {
      const state = await machinesState(cookie, projectId);
      machine = state.machines.find((m) => m.alias === MACHINE.alias);
      const job = state.jobs.find((j) => j.machineId === machine?.id && (j.running || j.queued));
      if (connected(machine) && job === undefined) break;
      const phase = job?.phase ?? "no job";
      if (phase !== lastPhase) console.log(`[machines] install: ${phase}`);
      lastPhase = phase;
      const done = state.jobs.find((j) => j.machineId === machine?.id && !j.running && !j.queued);
      if (job === undefined && done !== undefined && !connected(machine)) {
        if (done.result?.ok !== true) {
          throw new Error(`${done.kind} failed: ${JSON.stringify(done).slice(0, 2000)}`);
        }
        // An install leaves the machine's server stopped when it was not running before:
        // bring it up and hold a tunnel to it, as the card's Connect does.
        if (done.kind === "install") {
          await api(cookie, "POST", `${base}/${encodeURIComponent(machine.id)}/connect`, {});
        }
      }
      await sleep(2000);
    }
    if (!connected(machine)) throw new Error(`${MACHINE.alias} did not connect`);
  }
  console.log(`[machines] ${MACHINE.alias} connected as ${machine.machineId}`);

  // The machine's own Agents, created there through this server's proxy.
  const remote = `/server/${machine.machineId}/api/projects/${projectId}/agents`;
  const theirs = (await api(cookie, "GET", remote)).json.agents ?? [];
  for (const a of MACHINE_AGENTS) {
    if (theirs.some((x) => x.agentId === a.agentId)) continue;
    await api(cookie, "POST", remote, { agentId: a.agentId, ...a.en });
  }
  console.log(`[machines] server ready on ${BASE}, project ${projectId}`);
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Shots.
// ---------------------------------------------------------------------------

async function shots() {
  const { chromium } = await import("@playwright/test");
  mkdirSync(OUT_DIR, { recursive: true });
  const cookie = await login(ADMIN_PASSWORD);
  const projectId = (await api(cookie, "GET", "/api/projects")).json.projects[0].projectId;
  const machine = (await machinesState(cookie, projectId)).machines.find(
    (m) => m.alias === MACHINE.alias,
  );
  if (!connected(machine)) throw new Error(`${MACHINE.alias} is not connected`);
  const browser = await chromium.launch({
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      ...(process.env.SHOT_FONTCONFIG ? { FONTCONFIG_FILE: process.env.SHOT_FONTCONFIG } : {}),
    },
  });
  let lastPage = null;
  try {
    for (const lang of LANGS) {
      // Each language's shot sets the Agents' names for that language on both sides (the
      // built-ins keep their preset names); an Agent an earlier run left on either side goes
      // first.
      const sides = [
        { prefix: "", wanted: BUILTIN_AGENTS },
        { prefix: `/server/${machine.machineId}`, wanted: [...BUILTIN_AGENTS, ...MACHINE_AGENTS] },
      ];
      for (const { prefix, wanted } of sides) {
        const listed = (await api(cookie, "GET", `${prefix}/api/projects/${projectId}/agents`)).json
          .agents;
        for (const a of listed ?? []) {
          if (!wanted.some((w) => w.agentId === a.agentId)) {
            await api(cookie, "DELETE", `${prefix}/api/projects/${projectId}/agents/${a.agentId}`);
          }
        }
        for (const a of wanted) {
          await api(
            cookie,
            "PUT",
            `${prefix}/api/projects/${projectId}/agents/${a.agentId}/config`,
            {
              config: a[lang],
            },
          );
        }
      }

      const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
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
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const res = await page.request.post(`${BASE}/api/auth/login`, {
        data: { userId: "admin", password: ADMIN_PASSWORD },
      });
      if (!res.ok()) throw new Error(`browser login failed: ${res.status()}`);
      await page.goto(`${BASE}/agents`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);
      const tag = `[SSH: ${MACHINE.alias}]`;
      await page.getByText(MACHINE_AGENTS.at(-1)[lang].name).first().waitFor({ timeout: 60000 });
      await page.getByText(tag).first().waitFor({ timeout: 30000 });
      // The machine's cards are live once it answered in this page load.
      await page.waitForTimeout(3000);
      if (HOVER) {
        await page.getByText(MACHINE_AGENTS[0][lang].name).first().hover();
        await page.waitForTimeout(800);
      } else {
        await page.mouse.move(5, 5);
      }
      // The window from the top down to the last card, beside the sidebar it is reached from.
      const cards = page.getByText(tag);
      const last = await cards.last().boundingBox();
      const bottom = await page.evaluate(
        (y) => {
          // The card holding the last tag: its bottom edge.
          let el = document.elementFromPoint(720, y);
          let best = y;
          while (el && el !== document.body) {
            const r = el.getBoundingClientRect();
            if (r.width > 600 && r.height < 300) best = Math.max(best, r.bottom);
            el = el.parentElement;
          }
          return best;
        },
        last.y + last.height / 2,
      );
      const file = `penguinharness-0-2-17-machines-${lang}${SUFFIX}.png`;
      await page.screenshot({
        path: path.join(OUT_DIR, file),
        clip: { x: 0, y: 0, width: 1440, height: Math.min(1200, Math.ceil(bottom + 32)) },
      });
      writeFileSync(
        path.join(OUT_DIR, file.replace(/\.png$/, ".txt")),
        await page.evaluate(() => document.body.innerText),
      );
      await page.screenshot({ path: path.join(OUT_DIR, `full-${lang}${SUFFIX}.png`) });
      console.log(`[machines] ${file}`);
      await context.close();
    }
  } catch (err) {
    if (lastPage && !lastPage.isClosed()) {
      const dir = path.join(SCRATCH, "debug");
      mkdirSync(dir, { recursive: true });
      await lastPage.screenshot({ path: path.join(dir, "fail.png") }).catch(() => {});
      writeFileSync(
        path.join(dir, "fail.txt"),
        await lastPage.evaluate(() => document.body.innerText).catch(() => ""),
      );
    }
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
