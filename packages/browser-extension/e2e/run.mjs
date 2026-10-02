// End-to-end, the whole chain: the agent's `penguin browser` CLI → this checkout's server → the
// built extension (dist/) in a real Chromium → a local fixture site. Run through run.sh, which
// builds what is missing and wraps this in xvfb-run; set E2E_SHOTS=<dir> to keep pictures of the
// Chrome window (the Penguin tab group) and of the Web App's Browser panel in Chrome mode.
//
// The story: an admin adds a member; the member, signed in, has a Project and a conversation,
// mints a pairing code and pastes it with the server's address into the extension's options
// page. Then the agent of that conversation — the CLI with the admin API token and the
// conversation's PENGUIN_SESSION_ID, as inside a session — opens, scans, clicks, types and closes
// a page in the member's Chrome. Along the way: a cookie-store CDP method is refused (403), the
// same CLI without the session id is not the member and finds no Chrome, the Web App's panel
// mirrors the Chrome tabs, and revoking the pairing closes the socket with 4003.
import { chromium, request as playwrightRequest } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSite } from "./fixture-site.mjs";
import { ADMIN_ID, ADMIN_PASSWORD, startRealServer } from "./real-server.mjs";
import { screenshotX } from "./xshot.mjs";

const EXTENSION_ID = "dodgfhpcbmkjfcbgnoidablfgjjhhmgp";
const MEMBER = { userId: "alice", password: "password123" };
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const repoRoot = path.resolve(here, "..", "..", "..");
const shots = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null;
if (shots !== null) mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const oneLine = (text) => text.replace(/\s+/g, " ").trim().slice(0, 240);

async function eventually(fn, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) return undefined;
    await sleep(200);
  }
}

async function expectOk(res, what) {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  return res.status() === 204 ? null : res.json();
}

const fixture = await startFixtureSite();
const server = await startRealServer({ repoRoot });
const userDataDir = mkdtempSync(path.join(tmpdir(), "penguin-ext-e2e-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--silent-debugger-extension-api",
    "--window-position=0,0",
    "--window-size=1280,860",
    "--no-first-run",
  ],
});
const admin = await playwrightRequest.newContext({ baseURL: server.origin });

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  check("the pinned manifest key gives the id the server allows", extensionId === EXTENSION_ID);

  // Every socket the worker opens from here on, and how each one closed: the close code the
  // server sends is what the revoke check reads. The extension creates its sockets with the
  // global WebSocket at connect time, so wrapping it here sees the real ones.
  await worker.evaluate(() => {
    const Native = globalThis.WebSocket;
    globalThis.__e2e = { sockets: 0, closes: [] };
    globalThis.WebSocket = class extends Native {
      constructor(url, protocols) {
        super(url, protocols);
        globalThis.__e2e.sockets += 1;
        this.addEventListener("close", (e) =>
          globalThis.__e2e.closes.push({ code: e.code, reason: e.reason }),
        );
      }
    };
  });
  const sockets = () => worker.evaluate(() => globalThis.__e2e);

  // --- the member, their Project and a conversation -----------------------------------------------
  await expectOk(
    await admin.post("/api/auth/login", { data: { userId: ADMIN_ID, password: ADMIN_PASSWORD } }),
    "admin login",
  );
  await expectOk(await admin.post("/api/admin/users", { data: MEMBER }), "create the member");
  // The Chromium context's own request client: its cookie is the Web App page's too.
  const member = context.request;
  await expectOk(
    await member.post(`${server.origin}/api/auth/login`, { data: MEMBER }),
    "member login",
  );
  const { projects } = await expectOk(
    await member.get(`${server.origin}/api/projects`),
    "projects",
  );
  const projectId = projects[0].projectId;
  // A Project with no model pops the onboarding overlay over the dock; give it one (never called).
  await expectOk(
    await member.put(`${server.origin}/api/projects/${projectId}/models`, {
      data: {
        defaultModel: { provider: "custom", modelId: "claude-4-8" },
        models: [
          {
            provider: "custom",
            modelId: "claude-4-8",
            apiKey: "sk-e2e",
            baseUrl: "http://127.0.0.1:9",
            contextWindow: 1000000,
          },
        ],
      },
    }),
    "project model",
  );
  const { session } = await expectOk(
    await member.post(`${server.origin}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    }),
    "create a conversation",
  );
  const agentEnv = { PENGUIN_SESSION_ID: session.sessionId };
  const agent = (...args) => server.cli(["browser", ...args], agentEnv);

  const before = await agent("status");
  check(
    "before pairing, the agent's status names the member's missing Chrome (exit 1)",
    before.code === 1 && /extension_not_paired/.test(before.stdout),
    oneLine(before.stdout),
  );

  // --- pairing: a code minted for the signed-in member, pasted into the options page -----------
  const pairing = await expectOk(
    await member.post(`${server.origin}/api/builtin-browser/extension/pairings`, {
      headers: { origin: server.origin },
    }),
    "mint a pairing code",
  );
  check(
    "the server mints a one-time code for the signed-in member",
    /^[A-Za-z0-9_-]{43}$/.test(pairing.code) && pairing.origin === server.origin,
  );
  const optionsUrl = `chrome-extension://${extensionId}/pages/pair.html`;
  const opened = await eventually(() => context.pages().find((p) => p.url() === optionsUrl), 5_000);
  const options = opened ?? (await context.newPage());
  if (opened === undefined) await options.goto(optionsUrl);
  await options.fill("#server-url", server.origin);
  await options.fill("#code", pairing.code);
  await options.click("#connect");
  const row = await options
    .waitForSelector('li[data-status="connected"]', { timeout: 20_000 })
    .catch(() => null);
  check("the options page pairs and shows the server connected", row !== null);
  if (shots !== null && process.env.DISPLAY) {
    await options.bringToFront();
    await sleep(500);
    screenshotX(process.env.DISPLAY, path.join(shots, "extension-options.png"));
  }
  const paired = await eventually(async () => {
    const list = await expectOk(
      await member.get(`${server.origin}/api/builtin-browser/extension`),
      "paired list",
    );
    return list.connected !== undefined && list;
  });
  check(
    "the server lists the member's Chrome as paired and connected",
    paired !== undefined &&
      paired.paired.length === 1 &&
      paired.paired[0].id === paired.connected &&
      /^Chrome \d+/.test(paired.paired[0].name),
    paired ? `${paired.paired[0].name} ${paired.paired[0].version}` : "",
  );

  // --- the agent drives the member's Chrome through the CLI ------------------------------------
  const status = await agent("status");
  check(
    "the agent's status: available, backend chrome, naming the member's Chrome",
    status.code === 0 && /chrome/i.test(status.stdout) && !/unavailable/i.test(status.stdout),
    oneLine(status.stdout),
  );

  const ordersUrl = `${fixture.origin}/orders`;
  const open = await agent("open", ordersUrl);
  check("penguin browser open", open.code === 0, oneLine(open.stdout || open.stderr));
  const driven = await eventually(() =>
    worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
      if (tab === undefined || tab.groupId < 0) return null;
      const group = await chrome.tabGroups.get(tab.groupId);
      return { id: tab.id, title: group.title, color: group.color };
    }, ordersUrl),
  );
  check(
    "the page opens in the member's Chrome, in the blue Penguin group",
    driven?.title === "Penguin" && driven?.color === "blue",
    JSON.stringify(driven),
  );

  const scan = await agent("scan");
  check(
    "penguin browser scan reads the page",
    scan.code === 0 && scan.stdout.includes("Your Orders") && scan.stdout.includes("USB-C cable"),
    `${scan.stdout.length} chars`,
  );

  const click = await agent("click", ".order-row .buy-again");
  const toast = await eventually(async () => {
    const out = await agent("exec", "return document.querySelector('.toast')?.textContent ?? ''");
    return out.stdout.includes("Added to cart") && out.stdout;
  });
  check(
    "penguin browser click is a trusted click",
    click.code === 0 && toast?.includes("(trusted click)") === true,
    oneLine(toast ?? click.stderr),
  );

  const type = await agent("type", "lamp", "--selector", "#q", "--submit");
  const count = await eventually(async () => {
    const out = await agent("exec", "return document.getElementById('count')?.textContent ?? ''");
    return out.stdout.includes("4 orders placed") && out.stdout;
  });
  check(
    "penguin browser type fills the search and submits it",
    type.code === 0 && count !== undefined,
    oneLine(count ?? type.stderr),
  );

  const tabs = await agent("tabs", "--json");
  const listed = tabs.code === 0 ? JSON.parse(tabs.stdout).tabs : [];
  check(
    "penguin browser tabs lists only the agent's tab, none of the user's own",
    listed.length === 1 && listed[0].id === driven?.id,
    listed.map((t) => t.url).join(", "),
  );

  // --- what stays out of reach ----------------------------------------------------------------
  const cookies = await agent("cdp", "Network.getAllCookies");
  check(
    "a cookie-store CDP method is refused through the CLI",
    cookies.code !== 0 && cookies.stderr.includes("cdp_refused"),
    oneLine(cookies.stderr),
  );
  const apiToken = readFileSync(path.join(server.data, "api-token"), "utf8").trim();
  const raw = await fetch(`${server.origin}/api/builtin-browser/tabs/active/cdp`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({ method: "Network.getAllCookies", sessionId: session.sessionId }),
  });
  const rawBody = await raw.json().catch(() => null);
  check(
    "the same request answers 403 cdp_refused",
    raw.status === 403 && JSON.stringify(rawBody).includes("cdp_refused"),
    `${raw.status} ${JSON.stringify(rawBody)}`,
  );
  const stranger = await server.cli(["browser", "status"]);
  check(
    "without the session id the CLI acts for the admin, who has no Chrome paired",
    stranger.code === 1 && /extension_not_paired/.test(stranger.stdout),
    oneLine(stranger.stdout),
  );

  // --- pictures: the Chrome window, and the Web App's Browser panel in Chrome mode -------------
  const switched = await agent("switch", String(driven?.id));
  check("penguin browser switch shows the tab in Chrome", switched.code === 0);
  if (shots !== null && process.env.DISPLAY) {
    await sleep(800);
    screenshotX(process.env.DISPLAY, path.join(shots, "chrome-window.png"));
  }
  const app = await context.newPage();
  await app.goto(`${server.origin}/chat/${session.sessionId}`);
  await app.getByTestId("dock-toggle-right").click();
  await app.getByTestId("dock-pick-builtin-browser").click();
  const surface = app.getByTestId("browser-chrome-surface");
  const standing = await eventually(
    async () => (await surface.getAttribute("data-standing")) === "connected",
    15_000,
  );
  const strip = await eventually(
    async () => (await surface.getByTestId("builtin-browser-tab").count()) === 1,
    15_000,
  );
  check(
    "the Web App's Browser panel shows the Chrome surface with the agent's tab",
    standing === true && strip === true,
  );
  if (shots !== null) {
    await sleep(500);
    await app.screenshot({ path: path.join(shots, "webapp-browser-panel.png") });
    if (process.env.DISPLAY) {
      screenshotX(process.env.DISPLAY, path.join(shots, "webapp-window.png"));
    }
  }
  const stillOne = await agent("tabs", "--json");
  check(
    "the Web App's own tab stays out of the agent's list",
    stillOne.code === 0 && JSON.parse(stillOne.stdout).tabs.length === 1,
  );

  const close = await agent("close");
  const gone = await eventually(() =>
    worker.evaluate(
      async (id) => !(await chrome.tabs.query({})).some((t) => t.id === id),
      driven?.id,
    ),
  );
  check("penguin browser close closes the tab in Chrome", close.code === 0 && gone === true);

  // --- revoke -------------------------------------------------------------------------------------
  const socketsBefore = (await sockets()).sockets;
  await expectOk(
    await member.delete(`${server.origin}/api/builtin-browser/extension/${paired?.connected}`),
    "revoke",
  );
  const closed = await eventually(async () =>
    (await sockets()).closes.find((c) => c.code === 4003),
  );
  const forgotten = await eventually(async () => {
    const { servers } = await worker.evaluate(() => chrome.storage.local.get("servers"));
    return Array.isArray(servers) && servers.length === 0;
  });
  check(
    "revoking the pairing closes the socket with 4003 and the extension forgets the server",
    closed !== undefined && forgotten === true,
    JSON.stringify(closed),
  );
  await sleep(4_000);
  check("a revoked extension does not dial again", (await sockets()).sockets === socketsBefore);
  const after = await agent("status");
  check(
    "after the revoke the agent is told no Chrome is paired",
    after.code === 1 && /extension_not_paired/.test(after.stdout),
    oneLine(after.stdout),
  );
} catch (err) {
  check(
    "the run completed",
    false,
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
} finally {
  await context.close().catch(() => {});
  await admin.dispose().catch(() => {});
  if (results.some((r) => !r.ok)) console.log(`\n--- server output ---\n${server.tail()}`);
  await server.close();
  fixture.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
