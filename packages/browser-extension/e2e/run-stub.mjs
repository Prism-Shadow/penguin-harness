// End-to-end against a stub: the built extension (dist/) in a real Chromium, driven over its
// WebSocket link by a stub server (stub-server.mjs), against a local fixture site. Run through
// `run.sh --stub`, which builds and wraps this in xvfb-run; set E2E_SCREENSHOT=<file.png> to keep
// a picture of the window. It needs no server build and pins the link's frames one by one; the
// real chain (CLI, server, extension, Chrome) is run.mjs.
//
// Covers: pairing through the options page (token in the subprotocol, never in a URL); the
// pages in English under a Chinese Chrome until the user picks 中文, which turns the options page
// and the toolbar title Chinese at once, and the manifest's messages from _locales; the
// hello handshake and pings; open-tab into the "Penguin" group; a scan-like Runtime.evaluate;
// a trusted click and typing through Input.*; a relayed CDP event; a page the tab opens joining
// the group; refusals (a cookie method, a tab the server does not drive); close-tab; and a
// revoke closing the socket for good.
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureSite } from "./fixture-site.mjs";
import { startStubServer } from "./stub-server.mjs";
import { screenshotX } from "./xshot.mjs";

const EXTENSION_ID = "dodgfhpcbmkjfcbgnoidablfgjjhhmgp";
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const fixture = await startFixtureSite();
const stub = await startStubServer({ pingMs: 2_000 });
const userDataDir = mkdtempSync(path.join(tmpdir(), "penguin-ext-e2e-"));
// A Chinese Chrome: the extension's pages must still open in English. Chrome on Linux takes its
// language from LANGUAGE as well as --lang.
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  env: { ...process.env, LANGUAGE: "zh_CN" },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--silent-debugger-extension-api",
    "--window-position=0,0",
    "--window-size=1280,860",
    "--no-first-run",
    "--lang=zh-CN",
  ],
});
const HAN = /\p{Script=Han}/u;

const cdp = (tabId, method, params = {}, events) =>
  stub.request({ op: "cdp", tabId, method, params, ...(events ? { events } : {}) });

async function evaluate(tabId, expression) {
  const answer = await cdp(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return answer?.result?.value;
}

async function waitForLoad(tabId) {
  return eventually(async () => (await evaluate(tabId, "document.readyState")) === "complete");
}

async function click(tabId, selector) {
  const point = await evaluate(
    tabId,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await cdp(tabId, "Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
  }
}

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  check("the pinned manifest key gives the stable id", extensionId === EXTENSION_ID, extensionId);

  // --- pairing through the options page ---------------------------------------------------------
  const optionsUrl = `chrome-extension://${extensionId}/pages/pair.html`;
  const opened = await eventually(() => context.pages().find((p) => p.url() === optionsUrl), 5_000);
  check("the options page opens on install", opened !== undefined);
  const options = opened ?? (await context.newPage());
  if (opened === undefined) await options.goto(optionsUrl);
  await options.fill("#server-url", stub.origin);
  await options.fill("#code", stub.mintCode());
  await options.click("#connect");
  const row = await options
    .waitForSelector('li[data-status="connected"]', { timeout: 15_000 })
    .catch(() => null);
  check("the pair page shows the server connected", row !== null);
  if (process.env.E2E_SCREENSHOT && process.env.DISPLAY) {
    await options.bringToFront();
    await sleep(500);
    screenshotX(process.env.DISPLAY, process.env.E2E_SCREENSHOT.replace(/\.png$/, "-options.png"));
  }

  // --- the pages' language ---------------------------------------------------------------------
  const opening = await options.evaluate(() => ({
    browser: navigator.language,
    page: document.documentElement.lang,
    intro: document.getElementById("intro")?.textContent ?? "",
  }));
  check(
    "under a Chinese Chrome the options page opens in English",
    opening.browser.startsWith("zh") && opening.page === "en" && !HAN.test(opening.intro),
    JSON.stringify({ browser: opening.browser, page: opening.page }),
  );
  const listing = await worker.evaluate(() => ({
    name: chrome.i18n.getMessage("extName"),
    description: chrome.i18n.getMessage("extDescription"),
  }));
  check(
    "the manifest's name and description come from _locales, in Chrome's language",
    listing.name === "PenguinHarness Browser" && HAN.test(listing.description),
    listing.description,
  );
  const toolbarTitle = () => worker.evaluate(() => chrome.action.getTitle({}));
  await options.click('#language button[data-language="zh"]');
  const chinese = await eventually(async () => {
    const intro = (await options.textContent("#intro")) ?? "";
    const title = await toolbarTitle();
    return HAN.test(intro) && HAN.test(title) && { title };
  });
  check(
    "picking 中文 turns the options page and the toolbar title Chinese at once",
    chinese !== undefined &&
      (await worker.evaluate(() => chrome.storage.local.get("uiLanguage"))).uiLanguage === "zh",
    chinese?.title,
  );
  await options.click('#language button[data-language="en"]');
  const english = await eventually(async () => {
    const intro = (await options.textContent("#intro")) ?? "";
    const title = await toolbarTitle();
    return !HAN.test(intro) && !HAN.test(title) && title.includes("connected to") && { title };
  });
  check("picking EN turns both back", english !== undefined, english?.title);

  const pairRequest = stub.state.pairRequests[0];
  check(
    "pairing posts the code, a device name and the version, without a cookie",
    pairRequest !== undefined &&
      /^Chrome \d+/.test(pairRequest.name) &&
      pairRequest.version === "0.2.13" &&
      pairRequest.cookie === null &&
      pairRequest.origin === `chrome-extension://${extensionId}`,
    JSON.stringify({ name: pairRequest?.name, version: pairRequest?.version }),
  );
  const upgrade = stub.state.upgrades.find((u) => u.status === 101);
  check(
    "the socket offers penguin-browser.1 and the token as subprotocols, with no token in the URL",
    upgrade !== undefined &&
      upgrade.url === "/api/builtin-browser/extension/ws" &&
      upgrade.origin === `chrome-extension://${extensionId}` &&
      upgrade.protocols[0] === "penguin-browser.1" &&
      /^token\.[A-Za-z0-9_-]{43}$/.test(upgrade.protocols[1] ?? ""),
    JSON.stringify(upgrade?.protocols.map((p) => p.slice(0, 12))),
  );
  await eventually(() => stub.connected);
  const hello = stub.state.hello;
  check(
    "hello answers version 1, backend chrome, the extension's version",
    hello?.version === 1 &&
      hello?.backend === "chrome" &&
      hello?.extension?.version === "0.2.13" &&
      /^\d+\./.test(hello?.extension?.chrome ?? ""),
    JSON.stringify(hello),
  );

  // --- open-tab into the Penguin group ---------------------------------------------------------
  const { tab } = await stub.request({
    op: "open-tab",
    url: `${fixture.origin}/orders`,
    activate: true,
  });
  await stub.waitForEvent((e) => e.kind === "tab" && e.tab.id === tab.id);
  const group = await eventually(() =>
    worker.evaluate(async (tabId) => {
      const t = await chrome.tabs.get(tabId);
      if (t.groupId < 0) return null;
      const g = await chrome.tabGroups.get(t.groupId);
      return { id: g.id, title: g.title, color: g.color };
    }, tab.id),
  );
  check(
    "open-tab puts the tab in the blue Penguin group",
    group?.title === "Penguin" && group?.color === "blue",
    JSON.stringify(group),
  );

  // --- a scan-like Runtime.evaluate -------------------------------------------------------------
  check(
    "the page loads (Runtime.evaluate polling readyState)",
    (await waitForLoad(tab.id)) === true,
  );
  const scan = await evaluate(
    tab.id,
    `({ title: document.title, rows: [...document.querySelectorAll('.order-row')].map((r) => r.querySelector('.item-title').textContent) })`,
  );
  check(
    "a scan reads the page",
    scan?.title === "Your Orders" && scan.rows.length === 10 && scan.rows[0] === "USB-C cable",
    `${scan?.rows.length} rows`,
  );

  // --- click and type through Input.* -----------------------------------------------------------
  await click(tab.id, ".order-row .buy-again");
  const toast = await eventually(() =>
    evaluate(tab.id, `document.querySelector('.toast')?.textContent`),
  );
  check(
    "a click through Input.dispatchMouseEvent is trusted",
    toast === "Added to cart: USB-C cable (trusted click)",
    toast,
  );

  await cdp(tab.id, "Page.enable", {}, ["Page.loadEventFired"]);
  await evaluate(tab.id, `document.getElementById('q').focus()`);
  await cdp(tab.id, "Input.insertText", { text: "lamp" });
  for (const type of ["keyDown", "keyUp"]) {
    await cdp(tab.id, "Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  }
  const loaded = await stub
    .waitForEvent(
      (e) => e.kind === "cdp-event" && e.tabId === tab.id && e.method === "Page.loadEventFired",
    )
    .catch(() => null);
  check("the CDP event the server asked for is relayed", loaded !== null);
  await waitForLoad(tab.id);
  const count = await evaluate(tab.id, `document.getElementById('count').textContent`);
  check(
    "typing through Input.insertText and Enter submits the search",
    count === "4 orders placed",
    count,
  );
  const unasked = stub.state.events.some(
    (e) => e.kind === "cdp-event" && e.method !== "Page.loadEventFired",
  );
  check("no CDP event the server did not ask for is relayed", !unasked);

  // --- a page the driven tab opens joins the group ------------------------------------------------
  await click(tab.id, "#help");
  const helpEvent = await stub
    .waitForEvent((e) => e.kind === "tab" && e.tab.id !== tab.id && e.tab.url.endsWith("/help"))
    .catch(() => null);
  const helpGroup = helpEvent
    ? await eventually(() =>
        worker.evaluate(async (id) => (await chrome.tabs.get(id)).groupId, helpEvent.tab.id),
      )
    : undefined;
  check(
    "a target=_blank page of a driven tab joins the group",
    helpGroup === group?.id,
    `group ${helpGroup}`,
  );

  // --- refusals -------------------------------------------------------------------------------
  const cookies = await cdp(tab.id, "Network.getAllCookies").then(
    () => "answered",
    (err) => err.message,
  );
  check("a cookie-store CDP method is refused", cookies === "cdp_refused", cookies);
  const optionsTabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
    optionsUrl,
  );
  const foreign = await cdp(optionsTabId, "Runtime.evaluate", { expression: "1" }).then(
    () => "answered",
    (err) => err.message,
  );
  check("a tab the server does not drive is refused", foreign === "no_such_tab", foreign);
  const listed = await stub.request({ op: "tabs" });
  check(
    "tabs lists only the driven tabs",
    listed.tabs.length === 2 &&
      listed.tabs.every((t) => t.id === tab.id || t.id === helpEvent?.tab.id),
    listed.tabs.map((t) => t.url).join(", "),
  );
  const pongs = await eventually(() => stub.state.pongs > 0 && stub.state.pongs, 6_000);
  check("the server's pings are answered", pongs !== undefined, `${stub.state.pongs} pongs`);

  // --- a picture of the window for the PR -----------------------------------------------------------
  await stub.request({ op: "activate-tab", tabId: tab.id });
  if (process.env.E2E_SCREENSHOT && process.env.DISPLAY) {
    await sleep(800);
    screenshotX(process.env.DISPLAY, process.env.E2E_SCREENSHOT);
    console.log(`screenshot: ${process.env.E2E_SCREENSHOT}`);
  }

  // --- close-tab ------------------------------------------------------------------------------
  const closeAnswers = [];
  for (const tabId of [helpEvent?.tab.id ?? -1, tab.id]) {
    closeAnswers.push(
      await stub.request({ op: "close-tab", tabId }).then(
        (result) => JSON.stringify(result),
        (err) => err.message,
      ),
    );
  }
  const closed = await stub
    .waitForEvent((e) => e.kind === "tab-closed" && e.tabId === tab.id, 5_000)
    .catch(() => null);
  const gone = await eventually(() =>
    worker.evaluate(async (id) => !(await chrome.tabs.query({})).some((t) => t.id === id), tab.id),
  );
  check(
    "close-tab closes the tab and reports tab-closed",
    closed !== null && gone === true,
    `answers ${closeAnswers.join(", ")}; event ${closed !== null}; gone ${gone === true}; last events ${JSON.stringify(stub.state.events.slice(-4).map((e) => e.kind + ":" + (e.tabId ?? e.tab?.id)))}`,
  );

  // --- revoke ---------------------------------------------------------------------------------
  const attempts = stub.state.upgrades.length;
  stub.revoke();
  const forgotten = await eventually(async () => {
    const { servers } = await worker.evaluate(() => chrome.storage.local.get("servers"));
    return Array.isArray(servers) && servers.length === 0;
  });
  check(
    "a revoke closes the socket with 4003 and the extension forgets the server",
    stub.state.closes.some((c) => c.code === 4003) && forgotten === true,
  );
  await sleep(4_000);
  check("a revoked extension does not dial again", stub.state.upgrades.length === attempts);
} catch (err) {
  check(
    "the run completed",
    false,
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
} finally {
  await context.close().catch(() => {});
  stub.close();
  fixture.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
