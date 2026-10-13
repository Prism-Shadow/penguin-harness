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
 * page's canvas and icon, a dialog relayed as a CDP event and answered, a popup, DevTools opened
 * and closed around a command, cookies set and cleared, Project storage shared within a Project
 * and isolated across Projects (including targeted cookie import/clear), the guest's measured load, throttling
 * switched on and off, and the guest's renderer killed and the page reloaded — checks that a
 * window the page opens with `webviewTag=yes` cannot attach a guest, and prints
 * `BUILTIN-BROWSER-SMOKE {json}`, exiting non-zero when a check failed.
 *
 * Playback scenarios:
 * - Given playing audio or live video, when its tab is parked and allowed to throttle (a tab,
 *   menu or mode switch), playback advances without a pause, a freeze event or a document reload.
 * - Given a parked playing tab, when it is shown and parked repeatedly, playback continues.
 * - Given two players, when one pauses, the other keeps playing; the last pause restores
 *   throttling, and starting playback in the background lifts it again.
 * - Given playing media, when the renderer crashes, its playback protection is cleared.
 * - Given an idle background tab, when the window hides, native timer throttling still applies
 *   and releasing it restores the timer rate.
 */
import { execFileSync } from "node:child_process";
import { once } from "node:events";
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
const profile = path.join(path.dirname(process.env.PENGUIN_BB_SMOKE_BUNDLE), "profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);

const checks = [];
const check = (name, ok, detail) =>
  checks.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => finish("the smoke test timed out"), 120_000);

function finish(error) {
  clearTimeout(deadline);
  const ok = error === undefined && checks.every((c) => c.ok);
  process.stdout.write(`BUILTIN-BROWSER-SMOKE ${JSON.stringify({ ok, error, checks }, null, 2)}\n`);
  app.exit(ok ? 0 : 1);
}

async function run() {
  await app.whenReady();

  // Local PCM audio: no external service, codecs or audible sound required for playback.
  const sampleRate = 8_000;
  const pcm = Buffer.alloc(sampleRate * 2 * 60);
  const wav = Buffer.alloc(44);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  const audio = Buffer.concat([wav, pcm]);
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/audio.wav") {
      res.setHeader("content-type", "audio/wav");
      return res.end(audio);
    }
    if (url.pathname === "/app") return res.end(appPage);
    if (url.pathname === "/frame") return res.end(framePage);
    if (url.pathname === "/guest") return res.end(guestPage);
    if (url.pathname === "/guest2") return res.end(guest2Page);
    if (url.pathname === "/child") return res.end(childPage);
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
  // A window the app page opens with `webviewTag=yes` in window.open's features tries a guest of
  // its own, with no partition: the app's own session.
  const childPage = `<!doctype html><title>Child</title><body><script>
  addEventListener("load", () => {
    const has = customElements.get("webview") !== undefined;
    const el = document.createElement("webview");
    el.setAttribute("src", location.origin + "/guest?from=child");
    el.style.cssText = "width:200px;height:100px";
    let attached = false;
    el.addEventListener("did-attach", () => { attached = true; });
    document.body.appendChild(el);
    setTimeout(() => opener.postMessage({ childHasWebview: has, childAttached: attached }, "*"), 1500);
  });
</script></body>`;
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
  window.__smoke = { mainHasWebview: null, frame: null, child: null };
  addEventListener("load", () => { window.__smoke.mainHasWebview = customElements.get("webview") !== undefined; });
  addEventListener("message", (e) => {
    if (e.data && "childHasWebview" in e.data) window.__smoke.child = e.data;
    else window.__smoke.frame = e.data;
  });
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
  const evaluate = async (tabId, expression, userGesture = true) => {
    const reply = await send({
      op: "cdp",
      tabId,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true, userGesture },
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

  // A cdp command's `events` relays those CDP events of the tab and no others: the dialog the
  // page opens arrives as a cdp-event, and answering it through the relay lets the page go on.
  const cdpEvents = () => events.filter((e) => e.kind === "cdp-event");
  const watching = await send({
    op: "cdp",
    tabId,
    method: "Page.enable",
    params: {},
    events: ["Page.javascriptDialogOpening"],
  });
  await evaluate(tabId, 'setTimeout(() => { window.__answer = confirm("Leave the test?"); }); 1');
  for (let i = 0; i < 30 && cdpEvents().length === 0; i++) await sleep(100);
  const opened = cdpEvents()[0];
  const answered = await send({
    op: "cdp",
    tabId,
    method: "Page.handleJavaScriptDialog",
    params: { accept: false },
  });
  const answer = await evaluate(tabId, "window.__answer");
  const unwatched = await send({
    op: "cdp",
    tabId,
    method: "Page.disable",
    params: {},
    events: [],
  });
  check(
    "a cdp command's events relay the page's dialog, and that event only",
    watching.ok &&
      opened?.tabId === tabId &&
      opened.method === "Page.javascriptDialogOpening" &&
      opened.params.type === "confirm" &&
      opened.params.message === "Leave the test?" &&
      cdpEvents().every((e) => e.method === "Page.javascriptDialogOpening") &&
      answered.ok &&
      answer === false &&
      unwatched.ok,
    { opened, answer, relayed: cdpEvents().map((e) => e.method) },
  );

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

  // The load: every 10 s while there are guests, each tab's memory and CPU; the guest's own
  // renderer at least, so its memory is more than nothing.
  for (let i = 0; i < 130 && !events.some((e) => e.kind === "metrics"); i++) await sleep(100);
  const measured = events.filter((e) => e.kind === "metrics").at(-1);
  const guestLoad = measured?.tabs.find((t) => t.tabId === tabId);
  check(
    "the shell measures its guests' load",
    guestLoad !== undefined &&
      guestLoad.memoryKB > 1024 &&
      measured.totalKB >= guestLoad.memoryKB &&
      Number.isFinite(guestLoad.cpuPercent),
    measured,
  );

  // Throttling is the server's to switch: listed tabs may be throttled while hidden, others not.
  const guestContents = webContents.fromId(tabId);
  // A guest whose setting does not change is left alone: Electron shows a hidden page again on
  // every call, which would undo its throttling.
  const calls = [];
  const setBackgroundThrottling = guestContents.setBackgroundThrottling.bind(guestContents);
  guestContents.setBackgroundThrottling = (allowed) => {
    calls.push(allowed);
    setBackgroundThrottling(allowed);
  };
  const throttleOn = await send({ op: "throttle", tabIds: [tabId] });
  const onState = guestContents.getBackgroundThrottling();
  const throttleAgain = await send({ op: "throttle", tabIds: [tabId, 999_999] });
  const throttleOff = await send({ op: "throttle", tabIds: [] });
  const offState = guestContents.getBackgroundThrottling();
  guestContents.setBackgroundThrottling = setBackgroundThrottling;
  check(
    "throttle switches a guest's background throttling, and only on a change",
    throttleOn.ok &&
      onState === true &&
      throttleAgain.ok &&
      throttleOff.ok &&
      offState === false &&
      JSON.stringify(calls) === JSON.stringify([true, false]),
    { throttleOn, onState, throttleOff, offState, calls },
  );

  // Out of sight, as the Web App parks a tab. Media must survive the same throttle commands
  // that follow a tab, menu or mode switch, even when it is muted and never marked audible.
  await evaluate(tabId, "window.__ticks = 0; setInterval(() => { window.__ticks += 1; }, 10); 1");
  const park = (left) =>
    win.webContents.executeJavaScript(
      `(() => { const g = document.getElementById("good"); g.style.position = "fixed"; g.style.left = "${left}"; return true; })()`,
    );

  // Measure an idle page before starting media: Chromium may spare recently playing pages.
  const ticksPerSecond = async () => {
    // Reading the counter must not give Chromium a user gesture that lifts timer throttling.
    const before = await evaluate(tabId, "window.__ticks", false);
    await sleep(2_000);
    return ((await evaluate(tabId, "window.__ticks", false)) - before) / 2;
  };
  await park("-20000px");
  await sleep(500);
  const parkedFree = await ticksPerSecond();
  await send({ op: "throttle", tabIds: [tabId] });
  // Native throttling takes effect on a real visibility change; never freeze a page to force it.
  win.hide();
  await sleep(500);
  const parkedThrottled = await ticksPerSecond();
  await send({ op: "throttle", tabIds: [] });
  await sleep(500);
  const released = await ticksPerSecond();
  win.show();
  await park("0px");
  // Native scheduling chooses the cadence (about 15 Hz on macOS); only the forced freeze
  // guaranteed the old 1 Hz rate. Check reduced work without imposing that lifecycle shortcut.
  check(
    "a hidden idle guest is throttled on a visibility change, and releasing it restores timers",
    parkedFree > 30 && parkedThrottled < parkedFree / 2 && released > 30,
    { parkedFree, parkedThrottled, released },
  );

  const playback = () =>
    evaluate(
      tabId,
      `new Promise((resolve) => {
    const state = window.__playback;
    const player = state.player;
    const before = player.currentTime;
    let timeout;
    const done = () => {
      clearTimeout(timeout);
      player.removeEventListener("timeupdate", progressed);
      resolve({ time: player.currentTime, advanced: player.currentTime - before,
        paused: player.paused, pauses: state.pauses, freezes: state.freezes,
        error: player.error?.message ?? null });
    };
    const progressed = () => { if (player.currentTime >= before + 0.5) done(); };
    player.addEventListener("timeupdate", progressed);
    timeout = setTimeout(done, 3000);
  })`,
      false,
    );
  for (const kind of ["audio", "video"]) {
    const started = once(guestContents, "media-started-playing");
    await evaluate(
      tabId,
      `(async () => {
      const player = document.createElement(${JSON.stringify(kind)});
      let draw;
      if (${JSON.stringify(kind)} === "audio") {
        player.src = "/audio.wav";
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d");
        draw = setInterval(() => {
          context.fillStyle = "rgb(" + (Date.now() % 255) + " 0 0)";
          context.fillRect(0, 0, 32, 32);
        }, 50);
        player.srcObject = canvas.captureStream(20);
      }
      player.muted = true;
      document.body.appendChild(player);
      const state = window.__playback = { player, draw, pauses: 0, freezes: 0 };
      player.addEventListener("pause", () => state.pauses++);
      state.onFreeze = () => state.freezes++;
      document.addEventListener("freeze", state.onFreeze);
      await player.play();
      return true;
    })()`,
    );
    await started;
    for (let cycle = 0; cycle < 3; cycle++) {
      await park("-20000px");
      await send({ op: "throttle", tabIds: [tabId] });
      const hidden = await playback();
      await send({ op: "throttle", tabIds: [] });
      await park("0px");
      const shown = await playback();
      check(
        `${kind} keeps playing through background/foreground switch ${cycle + 1}`,
        [hidden, shown].every(
          (s) =>
            s.advanced >= 0.5 && !s.paused && s.pauses === 0 && s.freezes === 0 && s.error === null,
        ) && shown.time > hidden.time,
        { hidden, shown },
      );
    }
    await park("-20000px");
    await send({ op: "throttle", tabIds: [tabId] });
    const secondStarted = once(guestContents, "media-started-playing");
    await evaluate(
      tabId,
      `(async () => {
      const other = new Audio("/audio.wav");
      other.muted = true;
      window.__playback.other = other;
      await other.play();
      return true;
    })()`,
    );
    await secondStarted;
    const secondPaused = once(guestContents, "media-paused");
    await evaluate(tabId, "window.__playback.other.pause(); true");
    await secondPaused;
    const remaining = await playback();
    check(
      `pausing another player does not interrupt the remaining ${kind}`,
      !guestContents.getBackgroundThrottling() &&
        remaining.advanced >= 0.5 &&
        !remaining.paused &&
        remaining.pauses === 0 &&
        remaining.freezes === 0,
      remaining,
    );
    const lastPaused = once(guestContents, "media-paused");
    await evaluate(tabId, "window.__playback.player.pause(); true");
    await lastPaused;
    check(
      `pausing the last ${kind} restores background throttling`,
      guestContents.getBackgroundThrottling(),
    );
    const resumed = once(guestContents, "media-started-playing");
    await evaluate(tabId, "window.__playback.player.play().then(() => true)");
    await resumed;
    const background = await playback();
    check(
      `${kind} can resume while its tab stays in the background`,
      !guestContents.getBackgroundThrottling() &&
        background.advanced >= 0.5 &&
        !background.paused &&
        background.pauses === 1 &&
        background.freezes === 0,
      background,
    );
    const stopped = once(guestContents, "media-paused");
    await evaluate(
      tabId,
      `(() => {
      const state = window.__playback;
      state.player.pause();
      state.player.srcObject?.getTracks().forEach((track) => track.stop());
      state.player.remove();
      clearInterval(state.draw);
      document.removeEventListener("freeze", state.onFreeze);
      return true;
    })()`,
    );
    await stopped;
    await send({ op: "throttle", tabIds: [] });
    await park("0px");
  }

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

  const projectA = "persist:penguin-browser-project-" + "a".repeat(64);
  const projectB = "persist:penguin-browser-project-" + "b".repeat(64);
  async function projectPage(name, partition) {
    return win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const view = document.createElement("webview");
      view.id = ${JSON.stringify(name)};
      view.setAttribute("partition", ${JSON.stringify(partition)});
      view.style.cssText = "position:absolute;left:-20000px;width:800px;height:600px";
      view.addEventListener("did-finish-load", () => resolve(view.getWebContentsId()), {once:true});
      view.addEventListener("did-fail-load", (event) => reject(new Error(event.errorDescription)), {once:true});
      view.src = ${JSON.stringify(appOrigin + "/guest")};
      document.body.appendChild(view);
    })`);
  }
  const a1 = await projectPage("project-a1", projectA);
  const a2 = await projectPage("project-a2", projectA);
  const b1 = await projectPage("project-b1", projectB);
  await evaluate(a1, "document.cookie='project=A;path=/';localStorage.setItem('project','A')");
  await evaluate(b1, "document.cookie='project=B;path=/';localStorage.setItem('project','B')");
  check(
    "Sessions in one Project share cookies and storage",
    await evaluate(
      a2,
      "document.cookie.includes('project=A') && localStorage.getItem('project') === 'A'",
    ),
  );
  check(
    "another Project has independent cookies and storage",
    await evaluate(
      b1,
      "document.cookie.includes('project=B') && !document.cookie.includes('project=A') && localStorage.getItem('project') === 'B'",
    ),
  );
  check(
    "projectless storage stays separate",
    await evaluate(
      tabId,
      "!document.cookie.includes('project=') && localStorage.getItem('project') === null",
    ),
  );
  const projectImport = await send({
    op: "set-cookies",
    partition: projectA,
    cookies: [{ url: appOrigin + "/", name: "imported", value: "A", path: "/" }],
  });
  check(
    "cookie import only writes the selected Project",
    projectImport.ok &&
      (await evaluate(a2, "document.cookie.includes('imported=A')")) &&
      (await evaluate(b1, "!document.cookie.includes('imported=')")),
  );
  const projectClear = await send({
    op: "clear-data",
    partition: projectA,
    storages: ["cookies", "storage"],
  });
  check(
    "clearing a Project leaves other Projects signed in",
    projectClear.ok &&
      (await evaluate(a2, "document.cookie === '' && localStorage.getItem('project') === null")) &&
      (await evaluate(
        b1,
        "document.cookie.includes('project=B') && localStorage.getItem('project') === 'B'",
      )),
  );
  await win.webContents.executeJavaScript(
    "for (const id of ['project-a1','project-a2','project-b1']) document.getElementById(id).remove()",
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
  // The page menu scenario starts without the selection a previous mouse gesture can leave.
  await evaluate(tabId, "getSelection().removeAllRanges(); true");
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

  // A window the page opens with `webviewTag=yes` in its features gets the element (Electron
  // hands the features to a window no handler shapes), but no guest attaches in it.
  const windowsNow = new Set(BrowserWindow.getAllWindows());
  await win.webContents.executeJavaScript(
    `window.open("${appOrigin}/child", "_blank", "webviewTag=yes,width=400,height=300"); true`,
    true,
  );
  let child = null;
  for (let i = 0; i < 50 && child === null; i++) {
    await sleep(100);
    child = await win.webContents.executeJavaScript("window.__smoke.child");
  }
  const fromChild = webContents
    .getAllWebContents()
    .filter((w) => w.getURL().includes("from=child"));
  check(
    "a window given webviewTag=yes by its opener cannot attach a guest",
    child !== null && child.childAttached === false && fromChild.length === 0,
    { child, guestsFromChild: fromChild.length, logs: logs.filter((l) => l.includes("refused")) },
  );
  for (const opened of BrowserWindow.getAllWindows()) if (!windowsNow.has(opened)) opened.close();

  // The guest's renderer killed, as the system does when it runs out of memory: the tab stays,
  // reported crashed with why; CDP is refused at once rather than left waiting; a reload brings
  // the page back.
  win.show();
  win.focus();
  await park("0px");
  const playingBeforeCrash = once(guest, "media-started-playing");
  await evaluate(
    tabId,
    `(() => {
    window.__crashPlayer = new Audio("/audio.wav");
    window.__crashPlayer.muted = true;
    return window.__crashPlayer.play().then(() => true);
  })()`,
  );
  await playingBeforeCrash;
  await send({ op: "throttle", tabIds: [tabId] });
  const protectedBeforeCrash = !guest.getBackgroundThrottling();
  const crashedAt = events.length;
  process.kill(guest.getOSProcessId(), "SIGKILL");
  for (let i = 0; i < 50 && !events.slice(crashedAt).some((e) => e.kind === "tab-crashed"); i++)
    await sleep(100);
  await sleep(300);
  const crash = events.slice(crashedAt).find((e) => e.kind === "tab-crashed");
  const crashedTab = events
    .slice(crashedAt)
    .filter((e) => e.kind === "tab" && e.tab.id === tabId)
    .at(-1)?.tab;
  const refused = await send({
    op: "cdp",
    tabId,
    method: "Runtime.evaluate",
    params: { expression: "1" },
  });
  const listed = (await send({ op: "tabs" })).result?.tabs?.find((t) => t.id === tabId);
  check(
    "a renderer crash clears media playback protection",
    protectedBeforeCrash && guest.getBackgroundThrottling(),
  );
  await send({ op: "throttle", tabIds: [] });
  check(
    "a killed guest renderer is a crashed tab: reported, listed, and refused",
    crash?.tabId === tabId &&
      typeof crash.reason === "string" &&
      crashedTab?.crashed === crash.reason &&
      listed?.crashed === crash.reason &&
      !refused.ok &&
      refused.error === "tab_crashed",
    { crash, crashedTab, listed, refused },
  );
  guest.reload();
  for (let i = 0; i < 80 && guest.isCrashed(); i++) await sleep(100);
  await sleep(1_000);
  let revived = null;
  try {
    revived = await evaluate(tabId, "document.title");
  } catch (err) {
    revived = String(err);
  }
  const recovered = events.filter((e) => e.kind === "tab" && e.tab.id === tabId).at(-1)?.tab;
  check(
    "a reload brings a crashed tab back",
    revived === "Guest 2" && recovered !== undefined && recovered.crashed === undefined,
    { revived, recovered },
  );

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
