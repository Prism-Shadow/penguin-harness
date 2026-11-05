/**
 * Drive the pet widget in headless chromium over CDP: claim a session, open the widget
 * document, capture every console line and page exception, then report what the stage
 * ended up containing (SVG parts drawn = the rig actually rendered).
 *
 * usage: node pet-cdp.mjs <widgetUrl> <claimUrl> [seconds]
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [widgetUrl, claimUrl, seconds = "20"] = process.argv.slice(2);
if (!widgetUrl || !claimUrl) { console.error("need widgetUrl claimUrl"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "pet-cdp-"));
const port = 9333 + Math.floor(Math.random() * 400);
const chrome = join(process.env.HOME, ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const child = execFile(chrome, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu-sandbox", "--window-size=320,300",
  "about:blank",
], () => {});
child.on("error", (e) => { console.error("chrome spawn failed:", e.message); process.exit(1); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// wait for the devtools endpoint
let targets = null;
for (let i = 0; i < 50; i++) {
  await wait(200);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    targets = await res.json();
    if (targets?.length) break;
  } catch { /* not up yet */ }
}
if (!targets) { console.error("chrome devtools never came up"); process.exit(1); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });

let seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((ok) => {
  const id = ++seq;
  pending.set(id, ok);
  ws.send(JSON.stringify({ id, method, params }));
});
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    logs.push(`[console.${m.params.type}] ${text}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    logs.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`);
  } else if (m.method === "Log.entryAdded") {
    logs.push(`[log.${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  }
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Network.enable");

// claim the session first (the cookie lands in the profile), then open the widget
await send("Page.navigate", { url: claimUrl });
await wait(2500);
await send("Page.navigate", { url: widgetUrl });
await wait(Number(seconds) * 1000);

const probe = await send("Runtime.evaluate", { expression: `(() => {
  const root = document.getElementById("root");
  const svg = root?.querySelector("svg.kit");
  const parts = svg ? svg.querySelectorAll("image,g").length : 0;
  const canvas = root?.querySelectorAll("canvas,foreignObject").length ?? 0;
  return JSON.stringify({
    hasRoot: !!root, hasKitSvg: !!svg, parts,
    canvasOrFo: canvas,
    svgChildren: svg ? svg.innerHTML.length : 0,
    bubbleShown: document.getElementById("bubble")?.style.display !== "none",
    err: document.querySelector(".err")?.textContent ?? null,
  });
})()`, returnByValue: true });
logs.push(`[probe] ${probe.result?.value}`);

console.log(logs.join("\n"));
writeFileSync(join(profile, "shot-request.txt"), "ok");
try { child.kill(); } catch {}
await wait(300);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
