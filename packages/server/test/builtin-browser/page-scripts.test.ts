/**
 * The page scripts. Every script parses (always). Then, when a Chromium is at hand — a
 * Playwright download, or PENGUIN_TEST_CHROMIUM — they run for real: a headless Chromium is
 * driven over its DevTools socket through the same link, driver and actions the routes use,
 * with a small fake shell in between that forwards `cdp` to the page. A fixture page has
 * visible and hidden text, a long list, a toast, a field and a form, so the port is checked on
 * what GenericAgent's own behaviour hinges on: hidden elements dropped, the list folded to a
 * `[FAKE ELEMENT]` hint, truncation to the budget, a trusted click, transients and the diff.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DesktopBrowserCommandMessage } from "../../src/api/types.js";
import { BrowserActions } from "../../src/builtin-browser/actions.js";
import { BrowserDriver } from "../../src/builtin-browser/driver.js";
import { execExpression } from "../../src/builtin-browser/page-scripts/exec.js";
import {
  DISPATCH_INPUT_EVENTS_SCRIPT,
  clickTargetScript,
  focusScript,
  pointTargetScript,
} from "../../src/builtin-browser/page-scripts/input.js";
import {
  MONITOR_BEGIN_SCRIPT,
  MONITOR_END_SCRIPT,
  MONITOR_STOP_SCRIPT,
} from "../../src/builtin-browser/page-scripts/monitor.js";
import { scanScript } from "../../src/builtin-browser/page-scripts/simplify.js";
import { ShellLink } from "../../src/builtin-browser/shell-link.js";
import type { BrowserShellPort } from "../../src/builtin-browser/shell-link.js";
import { TabRegistry } from "../../src/builtin-browser/tabs.js";

/** Compiles `code` the way the driver wraps it, without running it. */
function compiles(code: string): void {
  const outer = new Function(`return (async () => {\n${code}\n});`) as () => unknown;
  expect(typeof outer()).toBe("function");
}

describe("page scripts parse", () => {
  it("as the driver runs them", () => {
    for (const code of [
      scanScript({ textOnly: false, maxChars: 35_000, instruction: 'say "hi"\n' }),
      scanScript({ textOnly: true, maxChars: 11_666 }),
      MONITOR_BEGIN_SCRIPT,
      MONITOR_END_SCRIPT,
      MONITOR_STOP_SCRIPT,
      clickTargetScript("a[href*='x']", 2),
      pointTargetScript(10.5, 20),
      focusScript("#q"),
      DISPATCH_INPUT_EVENTS_SCRIPT,
      `return ${execExpression("return document.title\n// a trailing comment")};`,
    ]) {
      compiles(code);
    }
  });
});

// --- a real Chromium -------------------------------------------------------

function findChromium(): string | null {
  const fromEnv = process.env.PENGUIN_TEST_CHROMIUM;
  if (fromEnv !== undefined && fromEnv !== "" && fs.existsSync(fromEnv)) return fromEnv;
  const cache =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(cache).sort().reverse();
  } catch {
    return null;
  }
  const inside: Record<string, string[]> = {
    chromium_headless_shell: [
      "chrome-headless-shell-linux64/chrome-headless-shell",
      "chrome-linux/headless_shell",
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
    ],
    chromium: ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-win/chrome.exe"],
  };
  for (const [prefix, rels] of Object.entries(inside)) {
    for (const dir of dirs.filter((d) => d.startsWith(`${prefix}-`))) {
      for (const rel of rels) {
        const bin = path.join(cache, dir, rel);
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return null;
}

const CHROMIUM = findChromium();

/** A DevTools socket: one command at a time per id, flat sessions. */
class Cdp {
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void }
  >();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id === undefined) return;
      const pending = this.pending.get(msg.id);
      if (pending === undefined) return;
      this.pending.delete(msg.id);
      if (msg.error !== undefined) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)));
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    this.seq += 1;
    const id = this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** The shell, played by a forwarder: `cdp` goes to the page's session, as a guest's debugger would. */
class ForwardingPort implements BrowserShellPort {
  private readonly listeners = new Set<(e: { data: unknown }) => void>();

  constructor(
    private readonly cdp: Cdp,
    private readonly sessionId: string,
  ) {}

  on(_event: "message", listener: (e: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "message", listener: (e: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    const msg = message as DesktopBrowserCommandMessage;
    const answer = (frame: Record<string, unknown>) => {
      for (const listener of this.listeners) {
        listener({ data: { type: "desktop-browser-reply", id: msg.id, ...frame } });
      }
    };
    const command = msg.command;
    if (command.op !== "cdp") {
      answer({ ok: true, result: command.op === "tabs" ? { tabs: [] } : { version: 1 } });
      return;
    }
    this.cdp.send(command.method, command.params ?? {}, this.sessionId).then(
      (result) => answer({ ok: true, result }),
      (err: Error) => answer({ ok: false, error: err.message }),
    );
  }
}

const ORDER_COUNT = 40;

const FIXTURE = `<!doctype html>
<html><head><title>Fixture</title><style>.hidden{display:none} li{margin:4px 0}</style></head>
<body>
<header class="nav"><a href="/">Home</a> <button id="menu">Menu</button></header>
<main id="main">
  <h1>Your Orders</h1>
  <p class="intro">Welcome back. These are the orders you placed at the store this year.</p>
  <div class="hidden" id="secret">This text is hidden and must never reach the reader</div>
  <ul id="orders">
${Array.from(
  { length: ORDER_COUNT },
  (_, i) =>
    `    <li class="order"><span class="date">2026-0${1 + (i % 9)}-1${i % 9}</span> <span class="total">$${(i * 3.5).toFixed(2)}</span> <a href="/o/${i}">Order #${1000 + i}: wireless headphones, model ${i}, with a description long enough to make each list item well over two hundred characters of HTML</a></li>`,
).join("\n")}
  </ul>
  <input id="q" name="q" placeholder="Search orders">
  <button id="go">Search</button>
  <div id="result"></div>
  <button id="toast">Add to cart</button>
  <form id="f"><input id="q2" name="q2"></form>
  <div id="submitted"></div>
</main>
<script>
  document.getElementById('go').addEventListener('click', (event) => {
    document.getElementById('go').dataset.trusted = String(event.isTrusted);
    document.getElementById('result').textContent =
      'Searched: ' + document.getElementById('q').value + '. Showing every order that mentions it, newest first.';
  });
  document.getElementById('toast').addEventListener('click', () => {
    const t = document.createElement('div');
    t.textContent = 'Added to cart successfully';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 700);
  });
  document.getElementById('f').addEventListener('submit', (event) => {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'Submitted: ' + new FormData(event.target).get('q2');
  });
</script>
</body></html>`;

/** Images whose addresses the scan shortens: a long file name, and a data: URL. */
const IMAGES = `<!doctype html><html><head><title>Images</title></head><body><main>
<h1>Pictures</h1>
<img src="/img/a-product-photo-with-a-file-name-long-enough.png" width="40" height="40" alt="photo">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="40" height="40" alt="pixel">
<p id="note">Two pictures.</p>
</main></body></html>`;

const STRICT = `<!doctype html><html><head><title>Strict</title></head><body>
<h1>Strict page</h1>
<ul id="items">
${Array.from(
  { length: 30 },
  (_, i) =>
    `  <li class="item"><b>Item ${i}</b> <span>${"a sentence of filler text ".repeat(9)}</span> <a href="/i/${i}">more</a></li>`,
).join("\n")}
</ul>
<div id="out"></div>
</body></html>`;

describe.skipIf(CHROMIUM === null)("page scripts in a real Chromium", () => {
  let browserProcess: ChildProcess | undefined;
  let profileDir = "";
  let server: http.Server | undefined;
  let origin = "";
  let cdp: Cdp | undefined;
  let link: ShellLink | undefined;
  let actions: BrowserActions;
  let driver: BrowserDriver;
  const TAB = 1;
  /** Requests for the placeholders the scan writes into a copy's addresses. */
  const placeholderRequests: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (/__(url|img|link|data)__/.test(req.url ?? "")) placeholderRequests.push(req.url!);
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (req.url === "/images") return res.end(IMAGES);
      if (req.url === "/strict") {
        // No script of its own, no eval, and Trusted Types enforced with no policy allowed.
        res.setHeader(
          "content-security-policy",
          "script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
        );
        return res.end(STRICT);
      }
      res.end(req.url === "/other" ? "<title>Other</title><p>Another page entirely</p>" : FIXTURE);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-bb-chromium-"));
    const child = spawn(
      CHROMIUM!,
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--window-size=1280,800",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    browserProcess = child;
    const endpoint = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timer = setTimeout(() => reject(new Error(`Chromium did not start: ${text}`)), 20_000);
      child.stderr!.on("data", (chunk: Buffer) => {
        text += String(chunk);
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]!);
        }
      });
      child.once("exit", (code) => reject(new Error(`Chromium exited (${code}): ${text}`)));
    });
    cdp = await Cdp.connect(endpoint);
    const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as {
      targetId: string;
    };
    const { sessionId } = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as {
      sessionId: string;
    };
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    link = new ShellLink(new ForwardingPort(cdp, sessionId));
    driver = new BrowserDriver(link);
    actions = new BrowserActions({ driver, tabs: new TabRegistry(), timing: { popupClaimMs: 0 } });
  }, 60_000);

  afterAll(async () => {
    link?.dispose();
    cdp?.close();
    browserProcess?.kill();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    if (profileDir !== "") fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const load = async () => {
    await actions.navigate(TAB, `${origin}/`);
  };

  it("scans the visible page, folds the long list and drops what is hidden", async () => {
    await load();
    const { content, truncated } = await actions.scan(TAB, {});
    expect(truncated).toBe(false);
    expect(content).toContain("Your Orders");
    expect(content).toContain("Welcome back.");
    expect(content).not.toContain("must never reach the reader");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("style=");
    // Three items stay; the rest is one hint naming the selector that finds them.
    expect(content).toContain("Order #1000");
    expect(content).toContain("Order #1002");
    expect(content).not.toContain(`Order #${1000 + ORDER_COUNT - 1}:`);
    const hint = /\[FAKE ELEMENT\] (\d+) more items hidden, selector: "([^"]+)"/.exec(content);
    expect(hint).not.toBeNull();
    expect(Number(hint![1])).toBe(ORDER_COUNT - 3);
    const selector = hint![2]!;
    expect(selector.startsWith("#orders > ")).toBe(true);
    // The selector really finds the hidden items on the live page.
    const counted = await actions.exec(
      TAB,
      `return document.querySelectorAll(${JSON.stringify(selector)}).length`,
      {
        noMonitor: true,
      },
    );
    expect(counted.value).toBe(ORDER_COUNT);
  }, 60_000);

  it("reads a page without making it load anything: shortened addresses are never requested", async () => {
    await actions.navigate(TAB, `${origin}/images`);
    placeholderRequests.length = 0;
    const { content } = await actions.scan(TAB, {});
    expect(content).toContain('src="__url__"');
    expect(content).toContain('src="__img__"');
    // exec takes the same simplified copy twice, for its diff.
    const changed = await actions.exec(
      TAB,
      "document.getElementById('note').textContent = 'Two pictures, one changed.'\nreturn 1",
    );
    expect(changed.diff?.topChange).toContain("one changed");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(placeholderRequests).toEqual([]);
  }, 60_000);

  it("keeps the items that match the instruction when it folds the list", async () => {
    await load();
    const { content } = await actions.scan(TAB, { instruction: "Order #1020" });
    expect(content).toContain("Order #1020");
    expect(content).toMatch(new RegExp(`\\[FAKE ELEMENT\\] ${ORDER_COUNT - 1} more items hidden`));
  }, 60_000);

  it("truncates to the budget, and reads as text with fields marked", async () => {
    await load();
    const small = await actions.scan(TAB, { maxChars: 800 });
    expect(small.truncated).toBe(true);
    expect(small.content.length).toBeLessThanOrEqual(1_600);
    expect(small.content.length).toBeGreaterThan(0);

    const text = await actions.scan(TAB, { textOnly: true });
    expect(text.content).toContain("Your Orders");
    expect(text.content).toContain('[INPUT #q name=q type=text "Search orders"]');
    expect(text.content).not.toContain("must never reach the reader");
    expect(text.content).not.toContain("<");
  }, 60_000);

  it("runs scripts GenericAgent's way: last expression, await, DOM results, errors", async () => {
    await load();
    const run = (script: string) => actions.exec(TAB, script, { noMonitor: true });
    expect((await run("return document.title")).value).toBe("Fixture");
    expect((await run("document.querySelectorAll('li.order').length")).value).toBe(ORDER_COUNT);
    expect((await run("await new Promise((r) => setTimeout(r, 10));\ndocument.title")).value).toBe(
      "Fixture",
    );
    expect((await run("document.querySelector('h1')")).value).toBe("<h1>Your Orders</h1>");
    const failed = await run("null.foo");
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/^TypeError: /);
  }, 60_000);

  it("reports the change a script made, and a toast that came and went", async () => {
    await load();
    const changed = await actions.exec(
      TAB,
      "document.getElementById('result').textContent = 'Changed by the script'; return 1",
    );
    expect(changed.status).toBe("success");
    expect(changed.diff?.changed).toBeGreaterThan(0);
    expect(changed.diff?.topChange).toContain("Changed by the script");

    const toast = await actions.exec(TAB, "document.getElementById('toast').click()");
    expect(toast.transients?.some((t) => "Added to cart successfully".startsWith(t))).toBe(true);

    const quiet = await actions.exec(TAB, "return 1 + 1");
    expect(quiet.value).toBe(2);
    expect(quiet.diff).toEqual({ changed: 0 });
    expect(quiet.suggestion).toBe("No visible change on the page.");
  }, 60_000);

  it("types into a field and clicks with a trusted event", async () => {
    await load();
    const typed = await actions.type(TAB, { text: "headphones", selector: "#q" });
    expect(typed.status).toBe("success");
    const clicked = await actions.click(TAB, { selector: "#go" });
    expect(clicked.status).toBe("success");
    expect(clicked.clicked).toMatchObject({ tag: "button", text: "Search" });
    expect(clicked.diff?.topChange).toContain("Searched: headphones");
    const trusted = await actions.exec(
      TAB,
      "return document.getElementById('go').dataset.trusted",
      {
        noMonitor: true,
      },
    );
    expect(trusted.value).toBe("true");

    const submitted = await actions.type(TAB, { text: "abc", selector: "#q2", submit: true });
    expect(submitted.status).toBe("success");
    const read = await actions.exec(
      TAB,
      "return document.getElementById('submitted').textContent",
      {
        noMonitor: true,
      },
    );
    expect(read.value).toBe("Submitted: abc");
  }, 60_000);

  it("reports a navigation the script caused as a reload", async () => {
    await load();
    const result = await actions.exec(TAB, `location.href = '${origin}/other'`);
    expect(result.reloaded).toBe(true);
    const title = await actions.exec(TAB, "return document.title", { noMonitor: true });
    expect(title.value).toBe("Other");
  }, 60_000);

  it("works on a page that enforces Trusted Types and forbids eval", async () => {
    await actions.navigate(TAB, `${origin}/strict`);
    const scan = await actions.scan(TAB, {});
    expect(scan.content).toContain("Strict page");
    expect(scan.content).toMatch(/\[FAKE ELEMENT\] 27 more items hidden, selector: "#items > /);
    const small = await actions.scan(TAB, { maxChars: 700 });
    expect(small.truncated).toBe(true);
    expect(small.content.length).toBeLessThanOrEqual(1_400);
    const run = (script: string) => actions.exec(TAB, script, { noMonitor: true });
    expect((await run("document.title")).value).toBe("Strict");
    expect((await run("await Promise.resolve(1);\ndocument.title")).value).toBe("Strict");
    const changed = await actions.exec(
      TAB,
      "document.getElementById('out').textContent = 'Changed on the strict page'; return 1",
    );
    expect(changed.diff?.topChange).toContain("Changed on the strict page");
  }, 60_000);

  it("takes screenshots", async () => {
    await load();
    const view = await actions.screenshot(TAB, {});
    expect(view.mime).toBe("image/png");
    expect(Buffer.from(view.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    const full = await actions.screenshot(TAB, { fullPage: true });
    expect(Buffer.from(full.data, "base64").length).toBeGreaterThan(
      Buffer.from(view.data, "base64").length,
    );
  }, 60_000);
});
