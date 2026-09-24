/**
 * Built-in browser smoke test on the runtime that hosts it: Electron itself, because what it
 * checks exists nowhere else — <webview> guests in the persist:penguin-browser partition, a
 * guest's webContents.debugger beside its DevTools, and Electron's rule that only the main
 * frame of a window with `webviewTag` gets the <webview> element.
 *
 *   node scripts/builtin-browser-smoke.mjs        (needs a display: `xvfb-run -a` on a headless box)
 *
 * Run by node, it bundles src/builtin-browser.ts with esbuild — the module main.ts bundles —
 * and starts Electron on this same file. Inside Electron it opens a window like the main one,
 * hosts the module in it, and loads a page holding one good guest, two the module must refuse
 * (another partition, a file: start page) and a cross-origin iframe that tries to create a
 * guest of its own. It then drives the relay the way the server does — hello, tabs, cdp, the
 * page's canvas and icon, a popup, DevTools opened and closed around a command, cookies set and
 * cleared — and prints `BUILTIN-BROWSER-SMOKE {json}`, exiting non-zero when a check failed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const pkgDir = path.resolve(path.dirname(self), "..");

if (!process.versions.electron) {
  const { build } = await import("esbuild");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-bb-smoke-"));
  const bundle = path.join(outDir, "builtin-browser.mjs");
  await build({
    entryPoints: [path.join(pkgDir, "src", "builtin-browser.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron"],
    outfile: bundle,
    logLevel: "warning",
  });
  const isWindows = process.platform === "win32";
  const electronBin = path.join(
    pkgDir,
    "node_modules",
    ".bin",
    isWindows ? "electron.cmd" : "electron",
  );
  const env = { ...process.env, PENGUIN_BB_SMOKE_BUNDLE: bundle };
  delete env.ELECTRON_RUN_AS_NODE;
  let status = 0;
  try {
    execFileSync(electronBin, [self, "--no-sandbox"], { stdio: "inherit", env, shell: isWindows });
  } catch (err) {
    status = typeof err?.status === "number" ? err.status : 1;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  process.exit(status);
}

// --- inside Electron ---------------------------------------------------------

const { app, BrowserWindow, Menu, webContents } = await import("electron");
const { createBuiltinBrowserShell } = await import(
  pathToFileURL(process.env.PENGUIN_BB_SMOKE_BUNDLE).href
);

const checks = [];
const check = (name, ok, detail) =>
  checks.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => finish("the smoke test timed out"), 90_000);

function finish(error) {
  clearTimeout(deadline);
  const ok = error === undefined && checks.every((c) => c.ok);
  process.stdout.write(`BUILTIN-BROWSER-SMOKE ${JSON.stringify({ ok, error, checks }, null, 2)}\n`);
  app.exit(ok ? 0 : 1);
}

async function run() {
  await app.whenReady();

  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/app") return res.end(appPage);
    if (url.pathname === "/frame") return res.end(framePage);
    if (url.pathname === "/guest") return res.end(guestPage);
    if (url.pathname === "/guest2") return res.end(guest2Page);
    return res.end(`<title>${url.pathname}</title>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const appOrigin = `http://localhost:${port}`;
  const otherOrigin = `http://127.0.0.1:${port}`;

  // Two pages of one site sharing an icon, neither setting a background of its own.
  const iconUrl = `${appOrigin}/icon.png`;
  const guestPage = `<!doctype html><title>Guest</title><link rel="icon" href="${iconUrl}">
<body><h1>Guest page</h1><a id="blank" href="${appOrigin}/from-link" target="_blank">new tab</a></body>`;
  const guest2Page = `<!doctype html><title>Guest 2</title><link rel="icon" href="${iconUrl}">
<body><h1>Second guest page</h1></body>`;
  // Electron defines <webview> once the document leaves "loading" (readystatechange), so both
  // frames look after load; the frame also tries to create a guest then.
  const framePage = `<!doctype html><title>Frame</title><body><script>
  addEventListener("load", () => {
    const has = customElements.get("webview") !== undefined;
    const el = document.createElement("webview");
    el.setAttribute("partition", "persist:penguin-browser");
    el.setAttribute("src", "${appOrigin}/guest?from=iframe");
    el.style.cssText = "width:200px;height:100px";
    document.body.appendChild(el);
    parent.postMessage({ hasWebview: has, attachable: typeof el.getWebContentsId === "function" }, "*");
  });
</script></body>`;
  const appPage = `<!doctype html><title>App</title><body>
<webview id="good" partition="persist:penguin-browser" src="${appOrigin}/guest" style="width:800px;height:400px"></webview>
<webview partition="persist:elsewhere" src="${appOrigin}/guest?wrong=partition" style="width:10px;height:10px"></webview>
<webview partition="persist:penguin-browser" src="file:///etc/hostname" style="width:10px;height:10px"></webview>
<iframe src="${otherOrigin}/frame" style="width:300px;height:150px"></iframe>
<script>
  window.__smoke = { mainHasWebview: null, frame: null };
  addEventListener("load", () => { window.__smoke.mainHasWebview = customElements.get("webview") !== undefined; });
  addEventListener("message", (e) => { window.__smoke.frame = e.data; });
</script></body>`;

  const replies = new Map();
  const events = [];
  const logs = [];
  const shell = createBuiltinBrowserShell({
    post(message) {
      if (message.type === "desktop-browser-reply") replies.get(message.id)?.(message);
      else if (message.type === "desktop-browser-event") events.push(message.event);
    },
    locale: () => "en",
    log: (line) => logs.push(line),
  });
  let seq = 0;
  const send = (command) =>
    new Promise((resolve, reject) => {
      seq += 1;
      const id = `smoke-${seq}`;
      const timer = setTimeout(() => reject(new Error(`no reply to ${command.op}`)), 15_000);
      replies.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      if (!shell.handle({ type: "desktop-browser-command", id, command })) {
        reject(new Error(`${command.op} was not taken as a browser command`));
      }
    });
  const evaluate = async (tabId, expression) => {
    const reply = await send({
      op: "cdp",
      tabId,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    });
    if (!reply.ok) throw new Error(reply.error);
    return reply.result.result.value;
  };

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  const attachedUrls = [];
  win.webContents.on("did-attach-webview", (_event, wc) => {
    wc.once("did-finish-load", () => attachedUrls.push(wc.getURL()));
  });
  shell.host(win);
  await win.loadURL(`${appOrigin}/app`);
  // Every guest the page asked for has had its chance to attach and load.
  for (
    let i = 0;
    i < 50 &&
    !(attachedUrls.length >= 1 && events.some((e) => e.kind === "tab" && e.tab.title === "Guest"));
    i++
  ) {
    await sleep(100);
  }
  await sleep(1_500);

  const smoke = await win.webContents.executeJavaScript("window.__smoke");
  check("the main frame has the <webview> element", smoke.mainHasWebview === true, smoke);
  check(
    "a cross-origin iframe does not",
    smoke.frame?.hasWebview === false && smoke.frame?.attachable === false,
    smoke.frame,
  );
  check(
    "only the good guest attached (wrong partition, file: page and the iframe's were refused)",
    attachedUrls.length === 1 && attachedUrls[0] === `${appOrigin}/guest`,
    { attachedUrls, logs },
  );

  const hello = await send({ op: "hello" });
  check(
    "hello",
    hello.ok && hello.result.version === 1 && hello.result.partition === "persist:penguin-browser",
    hello,
  );
  const tabs = await send({ op: "tabs" });
  const guestTab = tabs.result?.tabs?.[0];
  check(
    "tabs lists the guest",
    tabs.ok &&
      tabs.result.tabs.length === 1 &&
      guestTab.url === `${appOrigin}/guest` &&
      guestTab.title === "Guest",
    tabs.result,
  );
  const tabId = guestTab?.id;
  check(
    "tab events were pushed",
    events.some((e) => e.kind === "tab" && e.tab.id === tabId),
  );

  const ua = await evaluate(tabId, "navigator.userAgent");
  check(
    "sites see a plain Chrome user agent",
    !/Electron|PenguinHarness|penguin/i.test(ua) && /Chrome\//.test(ua),
    ua,
  );
  check(
    "the guest has no Node",
    (await evaluate(tabId, "typeof require + ':' + typeof process")) === "undefined:undefined",
  );
  check("cdp evaluates in the guest", (await evaluate(tabId, "document.title")) === "Guest");

  // The guest is opaque: a page with no background of its own is drawn on a browser's white
  // canvas, where a transparent guest would show the app behind it (its dark theme, say).
  const shot = await webContents.fromId(tabId).capturePage();
  const { width: shotWidth, height: shotHeight } = shot.getSize();
  const blankAt = ((shotHeight - 10) * shotWidth + Math.floor(shotWidth / 2)) * 4;
  const canvas = [...shot.toBitmap().subarray(blankAt, blankAt + 4)];
  check(
    "a page with no background is drawn on an opaque white canvas",
    canvas.every((value) => value === 255),
    canvas,
  );
  const lastTab = (url) =>
    events.filter((e) => e.kind === "tab" && e.tab.id === tabId && e.tab.url === url).at(-1)?.tab;
  const firstPage = lastTab(`${appOrigin}/guest`);
  check("the page's icon rides its tab events", firstPage?.favicon === iconUrl, { firstPage });

  const windowsBefore = BrowserWindow.getAllWindows().length;
  const contentsBefore = webContents.getAllWebContents().length;
  await evaluate(tabId, `window.open("${appOrigin}/popup"); 1`);
  await evaluate(tabId, `document.getElementById("blank").click(); 1`);
  await sleep(1_000);
  const opens = events.filter((e) => e.kind === "open-request");
  check(
    "window.open and target=_blank become open requests",
    opens.some((e) => e.url === `${appOrigin}/popup` && e.openerTabId === tabId) &&
      opens.some((e) => e.url === `${appOrigin}/from-link`),
    opens,
  );
  check(
    "no popup window or webContents was created",
    BrowserWindow.getAllWindows().length === windowsBefore &&
      webContents.getAllWebContents().length === contentsBefore,
    { windowsBefore, windowsAfter: BrowserWindow.getAllWindows().length },
  );

  const missing = await send({
    op: "cdp",
    tabId: 999_999,
    method: "Runtime.evaluate",
    params: { expression: "1" },
  });
  check("an unknown tab is no_such_tab", !missing.ok && missing.error === "no_such_tab", missing);
  const unknown = await send({ op: "reboot" });
  check("an unknown op is refused", !unknown.ok && unknown.error === "unknown_op", unknown);

  // DevTools on the guest: the relay keeps working while it is open and after it closes.
  const guest = webContents.fromId(tabId);
  const detachReasons = [];
  guest.debugger.on("detach", (_event, reason) => detachReasons.push(reason));
  guest.openDevTools({ mode: "detach" });
  for (let i = 0; i < 50 && !guest.isDevToolsOpened(); i++) await sleep(100);
  await sleep(1_000);
  let withDevTools = null;
  try {
    withDevTools = await evaluate(tabId, "1 + 1");
  } catch (err) {
    withDevTools = String(err);
  }
  check("cdp works with DevTools open", withDevTools === 2, {
    withDevTools,
    devToolsOpened: guest.isDevToolsOpened(),
    detachReasons,
  });
  guest.closeDevTools();
  await sleep(500);
  let afterDevTools = null;
  try {
    afterDevTools = await evaluate(tabId, "2 + 2");
  } catch (err) {
    afterDevTools = String(err);
  }
  check("cdp works after DevTools closed", afterDevTools === 4, { afterDevTools, detachReasons });
  // A debugger detached under the relay (what DevTools could do) re-attaches on the next command.
  guest.debugger.detach();
  let reattached = null;
  try {
    reattached = await evaluate(tabId, "3 + 3");
  } catch (err) {
    reattached = String(err);
  }
  check("cdp re-attaches after a detach", reattached === 6, reattached);

  const cookies = await send({
    op: "set-cookies",
    cookies: [
      { url: `${appOrigin}/`, name: "smoke", value: "1", path: "/" },
      { url: "not a url", name: "broken", value: "s3cr3t-cookie-value" },
    ],
  });
  check(
    "set-cookies sets and counts",
    cookies.ok &&
      cookies.result.set === 1 &&
      cookies.result.failed === 1 &&
      cookies.result.errors.length === 1 &&
      !cookies.result.errors[0].includes("s3cr3t"),
    cookies.result,
  );
  check(
    "the guest sees the cookie",
    String(await evaluate(tabId, "document.cookie")).includes("smoke=1"),
  );
  const cleared = await send({ op: "clear-data", storages: ["cookies", "cache"] });
  await sleep(500);
  check(
    "clear-data clears the cookies",
    cleared.ok && !String(await evaluate(tabId, "document.cookie")).includes("smoke=1"),
    cleared,
  );

  // The right-click menu: a real right-click (CDP input through the relay), the template the
  // module builds for it captured on its way to Menu, then two of its entries used.
  const menus = [];
  const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
  Menu.buildFromTemplate = (template) => {
    menus.push(template);
    const menu = buildFromTemplate(template);
    setTimeout(() => menu.closePopup(), 300);
    return menu;
  };
  const rightClick = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send({
        op: "cdp",
        tabId,
        method: "Input.dispatchMouseEvent",
        params: {
          type,
          x,
          y,
          button: "right",
          buttons: type === "mousePressed" ? 2 : 0,
          clickCount: 1,
        },
      });
    }
    await sleep(700);
  };
  const link = await evaluate(
    tabId,
    `(() => { const r = document.getElementById("blank").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  await rightClick(link.x, link.y);
  const linkMenu = (menus[0] ?? []).map((item) => item.label ?? item.type);
  check(
    "right-clicking a link offers its entries and Inspect",
    ["Open link in new tab", "Copy link address", "separator", "Inspect"].every((l) =>
      linkMenu.includes(l),
    ),
    linkMenu,
  );
  menus[0]?.find((item) => item.label === "Open link in new tab")?.click();
  await sleep(200);
  check(
    "Open link in new tab asks for a background tab",
    events.some(
      (e) =>
        e.kind === "open-request" && e.url === `${appOrigin}/from-link` && e.background === true,
    ),
    events.filter((e) => e.kind === "open-request"),
  );
  await rightClick(400, 300);
  const pageMenu = (menus[1] ?? []).map((item) => item.label ?? item.type);
  check(
    "right-clicking the page offers Back / Forward / Reload and Inspect",
    JSON.stringify(pageMenu) ===
      JSON.stringify(["Back", "Forward", "Reload", "separator", "Inspect"]),
    pageMenu,
  );
  menus[1]?.find((item) => item.label === "Inspect")?.click();
  for (let i = 0; i < 50 && !guest.isDevToolsOpened(); i++) await sleep(100);
  await sleep(500);
  let afterInspect = null;
  try {
    afterInspect = await evaluate(tabId, "5 + 5");
  } catch (err) {
    afterInspect = String(err);
  }
  check(
    "Inspect opens DevTools and the relay keeps working",
    guest.isDevToolsOpened() && afterInspect === 10,
    {
      devToolsOpened: guest.isDevToolsOpened(),
      afterInspect,
    },
  );
  guest.closeDevTools();
  Menu.buildFromTemplate = buildFromTemplate;

  // A page on the same site keeps the tab's icon: Chromium announces no icons for a document
  // whose icons are the ones the tab already shows.
  await send({ op: "cdp", tabId, method: "Page.navigate", params: { url: `${appOrigin}/guest2` } });
  for (let i = 0; i < 50 && lastTab(`${appOrigin}/guest2`)?.loading !== false; i++)
    await sleep(100);
  await sleep(500);
  const secondPage = lastTab(`${appOrigin}/guest2`);
  check("a page on the same site keeps the tab's icon", secondPage?.favicon === iconUrl, {
    secondPage,
  });

  // Closing the guest (the page removes its element) reports the tab closed.
  await win.webContents.executeJavaScript('document.getElementById("good").remove()');
  for (let i = 0; i < 30 && !events.some((e) => e.kind === "tab-closed" && e.tabId === tabId); i++)
    await sleep(100);
  check(
    "removing the element reports tab-closed",
    events.some((e) => e.kind === "tab-closed" && e.tabId === tabId),
  );

  server.close();
  finish();
}

run().catch((err) => finish(err instanceof Error ? (err.stack ?? err.message) : String(err)));
