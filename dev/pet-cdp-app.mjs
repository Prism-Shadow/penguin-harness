/**
 * Open the real app, click the pet widget tile, and capture console/exceptions from every
 * frame (the page and the widget iframe alike) over CDP with auto-attach.
 *
 * usage: node pet-cdp-app.mjs <appUrl> <claimUrl> [seconds]
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [appUrl, claimUrl, seconds = "25"] = process.argv.slice(2);
if (!appUrl || !claimUrl) { console.error("need appUrl claimUrl"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "pet-cdp-"));
const port = 9800 + Math.floor(Math.random() * 300);
const chrome = join(process.env.HOME, ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const child = execFile(chrome, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-sandbox", "--enable-unsafe-swiftshader", "--window-size=1400,900",
  "about:blank",
], () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 60; i++) {
  await wait(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find((t) => t.type === "page");
    if (page) break;
  } catch { /* not up yet */ }
}
if (!page) { console.error("devtools never came up"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });

let seq = 0;
const pending = new Map();
const waits = [];
const send = (method, params = {}, sessionId) => new Promise((ok) => {
  const id = ++seq;
  pending.set(id, ok);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const logs = [];
const stamp = () => new Date().toISOString().slice(11, 19);

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  const sid = m.sessionId ? ` s${m.sessionId.slice(-4)}` : "";
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    logs.push(`${stamp()}${sid} [console.${m.params.type}] ${text}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    logs.push(`${stamp()}${sid} [exception] ${d.text} ${d.exception?.description ?? ""}`);
  } else if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    logs.push(`${stamp()}${sid} [log.${e.level}] ${e.text} ${e.url ?? ""}`);
  } else if (m.method === "Target.attachedToTarget") {
    const sid2 = m.params.sessionId;
    logs.push(`${stamp()} [attach ${m.params.targetInfo.type}] ${m.params.targetInfo.url}`);
    for (const en of ["Runtime.enable", "Log.enable", "Network.enable"])
      send(en, {}, sid2);
    if (m.params.targetInfo.type === "iframe") waits.push(sid2);
  }
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

await send("Page.navigate", { url: claimUrl });
await wait(2500);
await send("Page.navigate", { url: appUrl });
await wait(9000);

// find the pet tile and click it
const click = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
  const tiles = [...document.querySelectorAll("button")];
  const tile = tiles.find((b) => /(pet|宠物)/i.test(b.getAttribute("title") ?? "") || b.textContent.trim().toLowerCase() === "pet");
  if (!tile) return "no-tile: " + tiles.slice(-6).map((b) => b.getAttribute("title") ?? b.textContent.trim()).join(" | ");
  tile.click();
  return "clicked";
})()` });
logs.push(`${stamp()} [tile] ${click.result?.value}`);
await wait(Number(seconds) * 1000);

// probe every attached iframe session for the widget's internals
for (const sid of waits) {
  const probe = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const root = document.getElementById("root");
    const svg = root?.querySelector("svg.kit");
    return JSON.stringify({
      url: location.href.slice(0, 90), hasKitSvg: !!svg,
      parts: svg ? svg.querySelectorAll("image,g").length : 0,
      fo: root?.querySelectorAll("foreignObject,canvas").length ?? 0,
      err: document.querySelector(".err")?.textContent ?? null,
    });
})()` }, sid).catch((e) => ({ result: { value: "probe-failed " + e.message } }));
  logs.push(`${stamp()} [probe] ${probe.result?.value}`);
}

// probe the widget iframe from the main frame too (same-origin: contentDocument works)
const iframeProbe = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
  const f = document.querySelector("iframe");
  if (!f) return "no-iframe-in-app";
  try {
    const d = f.contentDocument;
    const svg = d?.getElementById("root")?.querySelector("svg.kit");
    return JSON.stringify({
      src: f.getAttribute("src"),
      loaded: !!d, hasKitSvg: !!svg,
      parts: svg ? svg.querySelectorAll("image,g").length : 0,
      fo: d?.getElementById("root")?.querySelectorAll("foreignObject,canvas").length ?? 0,
      err: d?.querySelector(".err")?.textContent ?? null,
    });
  } catch (e) { return "cross-origin: " + e.message; }
})()` });
logs.push(`${stamp()} [iframe-probe] ${iframeProbe.result?.value}`);

console.log(logs.join("\n") || "(no output)");
try { child.kill(); } catch {}
await wait(300);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
