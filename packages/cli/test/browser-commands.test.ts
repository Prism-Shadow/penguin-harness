/**
 * `penguin browser`, driven through `cli()` in-process against the fake server's built-in
 * browser handler: each command's request (method, path, body — PENGUIN_SESSION_ID included
 * where the API takes it), the three sources of an exec script (argument, --file, stdin),
 * --save, the output contract of scan / exec / click / import / history, and the one-line
 * errors with exit code 1, API errors and argument errors alike.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinBrowserExecResult, BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { localMinute, RETURN_LIMIT, renderExec } from "../src/browser-output.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");
const SESSION = "session-2026-09-24-10-00-00-b10b0001";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let scratch: string;
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
/** Answers by `METHOD /path` (below /api/builtin-browser); anything else is a 404. */
let routes: Record<
  string,
  (
    body: Record<string, unknown> | undefined,
    query: URLSearchParams,
  ) => {
    status?: number;
    body?: unknown;
  }
>;

const tab = (id: number, title: string, url: string): BuiltinBrowserTab => ({
  id,
  title,
  url,
  loading: false,
  canGoBack: false,
  canGoForward: false,
});
const ORDERS = tab(12, "Your Orders", "https://www.amazon.com/your-orders/orders");
const GOOGLE = tab(15, "Google", "https://www.google.com/");

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  routes = {};
  server.builtinBrowser = ({ method, path: route, query, body }) => {
    const handler = routes[`${method} ${route}`];
    return handler
      ? handler(body, query)
      : { status: 404, body: { error: { code: "not_found", message: `no fake ${route}` } } };
  };
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-browser-cli-"));
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const out = () => stdout.join("");
const err = () => stderr.join("");
const browserRequests = () =>
  server.requests.filter((r) => r.path.startsWith("/api/builtin-browser/"));
const lastBody = () => browserRequests().at(-1)?.body;

/** Runs `penguin browser <args>` with `input` as a non-terminal stdin (a heredoc or a pipe). */
async function withStdin(input: string | null, args: string[]): Promise<number> {
  const stdin = new PassThrough();
  const real = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    if (input !== null) stdin.end(input);
    return await cli(["browser", ...args]);
  } finally {
    Object.defineProperty(process, "stdin", { value: real, configurable: true });
  }
}

const execResult = (over: Partial<BuiltinBrowserExecResult> = {}): BuiltinBrowserExecResult => ({
  status: "success",
  tabId: 12,
  ...over,
});

describe("status and tabs", () => {
  it("status prints availability and the tab list, the active tab starred", async () => {
    routes["GET /status"] = () => ({
      body: { available: true, tabs: [ORDERS, GOOGLE], activeTabId: 12 },
    });
    expect(await cli(["browser", "status"])).toBe(0);
    expect(out()).toBe("status: available\ntabs: *12 Your Orders | 15 Google\n");
  });

  it("status exits 1 when the browser is unavailable, saying what is needed", async () => {
    routes["GET /status"] = () => ({
      body: { available: false, reason: "no_window", tabs: [], activeTabId: null },
    });
    expect(await cli(["browser", "status"])).toBe(1);
    expect(out()).toBe(
      `status: unavailable (no_window)\nnote: ${t.browser.unavailableHint("no_window")}\n`,
    );
    expect(out()).toContain("desktop app");
  });

  it("tabs prints a table, and --json the response", async () => {
    routes["GET /tabs"] = () => ({ body: { tabs: [ORDERS, GOOGLE], activeTabId: 15 } });
    expect(await cli(["browser", "tabs"])).toBe(0);
    expect(out().split("\n")).toEqual([
      "ID   TITLE        URL",
      "12   Your Orders  https://www.amazon.com/your-orders/orders",
      "*15  Google       https://www.google.com/",
      "",
    ]);
    stdout.length = 0;
    expect(await cli(["browser", "tabs", "--json"])).toBe(0);
    expect(JSON.parse(out())).toEqual({ tabs: [ORDERS, GOOGLE], activeTabId: 15 });
  });
});

describe("open, switch, close", () => {
  it("open navigates the active tab, adding https:// to a bare host and the calling session", async () => {
    process.env.PENGUIN_SESSION_ID = SESSION;
    routes["POST /tabs/active/navigate"] = () => ({ body: { tab: ORDERS } });
    expect(await cli(["browser", "open", "amazon.com/your-orders/orders"])).toBe(0);
    expect(lastBody()).toEqual({
      url: "https://amazon.com/your-orders/orders",
      sessionId: SESSION,
    });
    expect(out()).toBe("tab 12 · Your Orders · https://www.amazon.com/your-orders/orders\n");
  });

  it("open --new-tab creates an active tab; --tab with it is refused before any request", async () => {
    routes["POST /tabs"] = () => ({ body: { tab: { ...GOOGLE, loading: true } } });
    expect(await cli(["browser", "open", "https://www.google.com/", "--new-tab"])).toBe(0);
    expect(lastBody()).toEqual({ url: "https://www.google.com/", activate: true });
    expect(out()).toBe("tab 15 · Google · https://www.google.com/ · loading\n");

    stdout.length = 0;
    expect(await cli(["browser", "open", "x.com", "--new-tab", "--tab", "3"])).toBe(1);
    expect(err()).toBe(`error: invalid_argument: ${t.browser.newTabWithTab()}\n`);
    expect(browserRequests()).toHaveLength(1);
  });

  it("switch activates a numeric tab and refuses anything else", async () => {
    routes["POST /tabs/15/activate"] = () => ({ body: { tab: GOOGLE } });
    expect(await cli(["browser", "switch", "15"])).toBe(0);
    expect(out()).toBe("tab 15 · Google · https://www.google.com/\n");
    expect(await cli(["browser", "switch", "active"])).toBe(1);
    expect(err()).toContain("error: invalid_argument: <tab-id> takes a positive whole number");
  });

  it("close closes the active tab by default, or the one named", async () => {
    routes["DELETE /tabs/active"] = () => ({ status: 204 });
    routes["DELETE /tabs/15"] = () => ({ status: 204 });
    expect(await cli(["browser", "close"])).toBe(0);
    expect(await cli(["browser", "close", "15", "--json"])).toBe(0);
    expect(out()).toBe(`${t.browser.closedActive()}\n{"closed":15}\n`);
  });
});

describe("scan", () => {
  it("prints the header, the tab list, a rule and the page", async () => {
    routes["POST /tabs/12/scan"] = () => ({
      body: {
        tab: ORDERS,
        tabs: [ORDERS, GOOGLE],
        activeTabId: 12,
        content: '<div id="orders">…</div>\n',
      },
    });
    expect(await cli(["browser", "scan", "--tab", "12", "--text", "--max-chars", "500"])).toBe(0);
    expect(lastBody()).toEqual({ textOnly: true, maxChars: 500 });
    expect(out()).toBe(
      [
        "tab 12 · Your Orders · https://www.amazon.com/your-orders/orders",
        "tabs: *12 Your Orders | 15 Google",
        "---",
        '<div id="orders">…</div>',
        "",
      ].join("\n"),
    );
  });

  it("refuses a bad --max-chars or --tab without a request", async () => {
    expect(await cli(["browser", "scan", "--max-chars", "0"])).toBe(1);
    expect(await cli(["browser", "scan", "--tab", "first"])).toBe(1);
    expect(err().split("\n")).toEqual([
      `error: invalid_argument: ${t.browser.positiveInt("--max-chars", "0")}`,
      `error: invalid_argument: ${t.browser.tabInvalid("first")}`,
      "",
    ]);
    expect(browserRequests()).toEqual([]);
  });
});

describe("exec", () => {
  it("sends the script with its options and prints the labelled lines", async () => {
    process.env.PENGUIN_SESSION_ID = SESSION;
    routes["POST /tabs/active/exec"] = () => ({
      body: execResult({
        value: { added: true },
        diff: { changed: 14, topChange: '<div class="cart">\n  <span>1 item</span>\n</div>' },
        transients: ["Added to cart", "Saved"],
        newTabs: [{ id: 16, url: "https://www.amazon.com/cart" }],
        suggestion: "Check the cart.",
      }),
    });
    const code = await cli([
      "browser",
      "exec",
      "document.querySelector('#add').click(); return {added: true}",
      "--no-monitor",
      "--timeout",
      "30s",
    ]);
    expect(code).toBe(0);
    expect(lastBody()).toEqual({
      script: "document.querySelector('#add').click(); return {added: true}",
      noMonitor: true,
      timeoutMs: 30_000,
      sessionId: SESSION,
    });
    expect(out()).toBe(
      [
        "status: success   tab: 12",
        'return: {"added":true}',
        "diff: 14 elements changed",
        '  <div class="cart">',
        "    <span>1 item</span>",
        "  </div>",
        'transients: "Added to cart" · "Saved"',
        "new tabs: 16 https://www.amazon.com/cart",
        "note: Check the cart.",
        "",
      ].join("\n"),
    );
  });

  it("shows a missing return, a reload, and a multi-line string as an indented block", async () => {
    let answer = execResult({
      reloaded: true,
      diff: { changed: 0 },
      suggestion: "No visible change on the page.",
    });
    routes["POST /tabs/active/exec"] = () => ({ body: answer });
    expect(await cli(["browser", "exec", "location.href = '/next'"])).toBe(0);
    expect(out()).toBe(
      [
        "status: success   tab: 12   page: reloaded",
        "return: undefined",
        "diff: 0 elements changed",
        "note: No visible change on the page.",
        "",
      ].join("\n"),
    );
    stdout.length = 0;
    answer = execResult({ value: "Order #1\nOrder #2" });
    expect(await cli(["browser", "exec", "return document.body.innerText"])).toBe(0);
    expect(out()).toBe("status: success   tab: 12\nreturn:\n  Order #1\n  Order #2\n");
  });

  it("cuts a long return value and points at --save", async () => {
    routes["POST /tabs/active/exec"] = () => ({
      body: execResult({ value: "x".repeat(RETURN_LIMIT + 50) }),
    });
    expect(await cli(["browser", "exec", "return big"])).toBe(0);
    expect(out()).toBe(
      `status: success   tab: 12\nreturn: ${"x".repeat(RETURN_LIMIT)} [truncated — use --save]\n`,
    );
  });

  it("--save writes the whole value and prints its start and the absolute path", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ order: `111-${i}`, total: `$${i}.99` }));
    routes["POST /tabs/active/exec"] = () => ({ body: execResult({ value: rows }) });
    const target = path.join(scratch, "out", "orders.json");
    expect(await cli(["browser", "exec", "return rows", "--save", target])).toBe(0);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual(rows);
    const shown = JSON.stringify(rows).slice(0, 170);
    expect(out()).toBe(`status: success   tab: 12\nreturn: ${shown}… [saved to ${target}]\n`);

    stdout.length = 0;
    routes["POST /tabs/active/exec"] = () => ({ body: execResult({ value: "short text" }) });
    const textFile = path.join(scratch, "page.txt");
    expect(await cli(["browser", "exec", "return t", "--save", textFile])).toBe(0);
    expect(fs.readFileSync(textFile, "utf8")).toBe("short text");
    expect(out()).toContain(`return: short text [saved to ${textFile}]`);
  });

  it("a script that failed in the page prints its error and exits 1", async () => {
    routes["POST /tabs/active/exec"] = () => ({
      body: execResult({
        status: "failed",
        error: "TypeError: x is not a function\n    at <anonymous>",
      }),
    });
    expect(await cli(["browser", "exec", "x()"])).toBe(1);
    expect(out()).toBe(
      "status: failed   tab: 12\nerror: TypeError: x is not a function at <anonymous>\n",
    );
  });

  it("reads the script from --file", async () => {
    routes["POST /tabs/active/exec"] = () => ({ body: execResult({ value: 1 }) });
    const file = path.join(scratch, "script.js");
    fs.writeFileSync(file, "return 1;\n");
    expect(await cli(["browser", "exec", "--file", file])).toBe(0);
    expect(lastBody()).toMatchObject({ script: "return 1;\n" });
    expect(await cli(["browser", "exec", "--file", path.join(scratch, "missing.js")])).toBe(1);
    expect(err()).toMatch(/^error: io_error: Cannot read .*missing\.js/);
  });

  it("reads the script from stdin: a heredoc with no argument, or -", async () => {
    routes["POST /tabs/active/exec"] = () => ({ body: execResult({ value: "ok" }) });
    routes["POST /tabs/15/exec"] = () => ({ body: execResult({ tabId: 15, value: 2 }) });
    const heredoc = "const rows = [...document.querySelectorAll('.order')];\nreturn rows.length;\n";
    expect(await withStdin(heredoc, ["exec"])).toBe(0);
    expect(lastBody()).toMatchObject({ script: heredoc });
    expect(await withStdin("return 2", ["exec", "-", "--tab", "15"])).toBe(0);
    expect(browserRequests().at(-1)).toMatchObject({
      path: "/api/builtin-browser/tabs/15/exec",
      body: { script: "return 2" },
    });
  });

  it("refuses two script sources, an empty script, and an idle stdin", async () => {
    expect(await cli(["browser", "exec", "return 1", "--file", "x.js"])).toBe(1);
    expect(await withStdin("", ["exec", "-"])).toBe(1);
    expect(await withStdin(null, ["exec"])).toBe(1);
    expect(err().split("\n")).toEqual([
      `error: invalid_argument: ${t.browser.scriptSources()}`,
      `error: invalid_argument: ${t.browser.scriptEmpty()}`,
      `error: invalid_argument: ${t.browser.scriptMissing()}`,
      "",
    ]);
    expect(browserRequests()).toEqual([]);
  });

  it("refuses a zero or malformed --timeout", async () => {
    expect(await cli(["browser", "exec", "return 1", "--timeout", "0"])).toBe(1);
    expect(await cli(["browser", "exec", "return 1", "--timeout", "soon"])).toBe(1);
    expect(err()).toContain(`error: invalid_argument: ${t.client.timeoutInvalid("0")}`);
    expect(browserRequests()).toEqual([]);
  });
});

describe("click, type, screenshot, cdp", () => {
  it("click sends a selector (with --index) or a point, and prints where it landed", async () => {
    routes["POST /tabs/active/click"] = () => ({
      body: execResult({
        clicked: { x: 512.4, y: 300.6, tag: "button", text: "Add to Cart" },
        diff: { changed: 3 },
      }),
    });
    expect(await cli(["browser", "click", "#add-to-cart-button", "--index", "0"])).toBe(0);
    expect(lastBody()).toEqual({ selector: "#add-to-cart-button", index: 0 });
    expect(out()).toBe(
      'status: success   tab: 12\nclicked: button "Add to Cart" at 512,301\ndiff: 3 elements changed\n',
    );
    expect(await cli(["browser", "click", "--at", "10, 20.5"])).toBe(0);
    expect(lastBody()).toEqual({ x: 10, y: 20.5 });
  });

  it("click needs exactly one target", async () => {
    expect(await cli(["browser", "click"])).toBe(1);
    expect(await cli(["browser", "click", "#a", "--at", "1,2"])).toBe(1);
    expect(await cli(["browser", "click", "--at", "1;2"])).toBe(1);
    expect(await cli(["browser", "click", "#a", "--index", "-1"])).toBe(1);
    expect(err().split("\n")).toEqual([
      `error: invalid_argument: ${t.browser.clickTarget()}`,
      `error: invalid_argument: ${t.browser.clickTarget()}`,
      `error: invalid_argument: ${t.browser.atInvalid("1;2")}`,
      `error: invalid_argument: ${t.browser.indexInvalid("-1")}`,
      "",
    ]);
  });

  it("type sends the text, the selector and submit", async () => {
    process.env.PENGUIN_SESSION_ID = SESSION;
    routes["POST /tabs/12/type"] = () => ({ body: execResult({ diff: { changed: 1 } }) });
    expect(
      await cli([
        "browser",
        "type",
        "usb c hub",
        "--selector",
        "#twotabsearchtextbox",
        "--submit",
        "--tab",
        "12",
      ]),
    ).toBe(0);
    expect(lastBody()).toEqual({
      text: "usb c hub",
      selector: "#twotabsearchtextbox",
      submit: true,
      sessionId: SESSION,
    });
    expect(out()).toBe("status: success   tab: 12\ndiff: 1 element changed\n");
  });

  it("screenshot writes the PNG and prints its path, size and weight", async () => {
    const png = Buffer.concat([
      Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
      Buffer.from([0, 0, 5, 0, 0, 0, 3, 32]), // 1280 x 800
      Buffer.alloc(2048),
    ]);
    routes["POST /tabs/active/screenshot"] = () => ({
      body: { mime: "image/png", data: png.toString("base64") },
    });
    const target = path.join(scratch, "shot.png");
    expect(await cli(["browser", "screenshot", "-o", target, "--full-page"])).toBe(0);
    expect(lastBody()).toEqual({ fullPage: true });
    expect(fs.readFileSync(target).equals(png)).toBe(true);
    expect(out()).toBe(`screenshot: ${target} (1280x800, 2 KB)\n`);
  });

  it("cdp passes the method and its params through and prints the result as JSON", async () => {
    routes["POST /tabs/active/cdp"] = (body) => ({
      body: { result: { frameId: "F1", echo: body?.params } },
    });
    expect(
      await cli(["browser", "cdp", "Page.navigate", "--params", '{"url":"https://example.com"}']),
    ).toBe(0);
    expect(lastBody()).toEqual({ method: "Page.navigate", params: { url: "https://example.com" } });
    expect(out()).toBe('{"frameId":"F1","echo":{"url":"https://example.com"}}\n');
    expect(await cli(["browser", "cdp", "navigate"])).toBe(1);
    expect(await cli(["browser", "cdp", "Page.navigate", "--params", "[1]"])).toBe(1);
    expect(err().split("\n")).toEqual([
      `error: invalid_argument: ${t.browser.methodInvalid("navigate")}`,
      `error: invalid_argument: ${t.browser.paramsInvalid()}`,
      "",
    ]);
  });
});

describe("import and history", () => {
  const SOURCES = [
    {
      id: "chrome:Default",
      browser: "chrome",
      browserName: "Chrome",
      profile: "Default",
      profileName: "Work",
      hasCookies: true,
      hasHistory: true,
    },
    {
      id: "chrome:Profile 1",
      browser: "chrome",
      browserName: "Chrome",
      profile: "Profile 1",
      profileName: "Personal",
      hasCookies: true,
      hasHistory: false,
    },
    {
      id: "firefox:ab12.default-release",
      browser: "firefox",
      browserName: "Firefox",
      profile: "ab12.default-release",
      profileName: "default-release",
      hasCookies: false,
      hasHistory: true,
    },
  ];
  beforeEach(() => {
    routes["GET /import/sources"] = () => ({ body: { sources: SOURCES } });
  });

  it("--list prints the profiles", async () => {
    expect(await cli(["browser", "import", "--list"])).toBe(0);
    expect(out().split("\n")).toEqual([
      "ID                            BROWSER  PROFILE          DATA",
      "chrome:Default                Chrome   Work             cookies, history",
      "chrome:Profile 1              Chrome   Personal         cookies",
      "firefox:ab12.default-release  Firefox  default-release  history",
      "",
    ]);
  });

  it("--from a browser imports its Default profile's cookies for the given sites", async () => {
    routes["POST /import"] = (body) => ({
      body: {
        sourceId: body?.sourceId,
        cookies: { found: 45, imported: 43, skipped: 2, failed: 0 },
        warnings: ["Skipped 2 cookies that could not be decrypted."],
      },
    });
    const code = await cli([
      "browser",
      "import",
      "--from",
      "Chrome",
      "--cookies",
      "--domain",
      "amazon.com",
      "--domain",
      "ebay.com, x.com",
    ]);
    expect(code).toBe(0);
    expect(lastBody()).toEqual({
      sourceId: "chrome:Default",
      cookies: true,
      history: false,
      domains: ["amazon.com", "ebay.com", "x.com"],
    });
    expect(out()).toBe(
      [
        "source: chrome:Default",
        "cookies: 43 imported, 2 skipped, 0 failed (45 found)",
        "warning: Skipped 2 cookies that could not be decrypted.",
        "",
      ].join("\n"),
    );
  });

  it("--from a source id imports both kinds when neither flag is given, without listing", async () => {
    routes["POST /import"] = () => ({
      body: {
        sourceId: "firefox:ab12.default-release",
        history: { found: 120, imported: 120 },
        warnings: [],
      },
    });
    expect(await cli(["browser", "import", "--from", "firefox:ab12.default-release"])).toBe(0);
    expect(lastBody()).toEqual({
      sourceId: "firefox:ab12.default-release",
      cookies: true,
      history: true,
    });
    expect(browserRequests().some((r) => r.path.endsWith("/import/sources"))).toBe(false);
    expect(out()).toBe("source: firefox:ab12.default-release\nhistory: 120 imported (120 found)\n");
  });

  it("refuses an unknown browser, a missing mode, and both modes", async () => {
    expect(await cli(["browser", "import", "--from", "safari"])).toBe(1);
    expect(await cli(["browser", "import"])).toBe(1);
    expect(await cli(["browser", "import", "--list", "--from", "chrome"])).toBe(1);
    expect(err().split("\n")).toEqual([
      `error: source_not_found: ${t.browser.sourceNotFound("safari", ["chrome", "firefox"])}`,
      `error: invalid_argument: ${t.browser.importMode()}`,
      `error: invalid_argument: ${t.browser.importMode()}`,
      "",
    ]);
  });

  it("a browser with several profiles and no Default needs a source id", async () => {
    const [work, personal] = [SOURCES[0]!, SOURCES[1]!];
    routes["GET /import/sources"] = () => ({
      body: { sources: [{ ...work, id: "chrome:Profile 2", profile: "Profile 2" }, personal] },
    });
    expect(await cli(["browser", "import", "--from", "chrome", "--cookies"])).toBe(1);
    expect(err()).toBe(
      `error: invalid_argument: ${t.browser.sourceAmbiguous("chrome", ["chrome:Profile 2", "chrome:Profile 1"])}\n`,
    );
    expect(browserRequests().some((r) => r.path.endsWith("/import"))).toBe(false);
  });

  it("history searches with the query and count and prints one line per page", async () => {
    const visited = Date.UTC(2026, 8, 23, 14, 3);
    routes["GET /history"] = (_body, query) => ({
      body: {
        entries: [
          {
            url: "https://www.amazon.com/your-orders/orders",
            title: "Your Orders",
            visitCount: 4,
            lastVisitAt: visited,
            source: "chrome",
          },
          {
            url: "https://www.amazon.com/",
            title: "",
            visitCount: 1,
            lastVisitAt: visited,
            source: "builtin",
          },
        ].slice(0, Number(query.get("limit"))),
      },
    });
    expect(await cli(["browser", "history", "amazon orders", "-n", "5"])).toBe(0);
    expect(browserRequests().at(-1)?.search).toBe("?q=amazon%20orders&limit=5");
    const stamp = localMinute(visited);
    expect(out()).toBe(
      `${stamp} · Your Orders · https://www.amazon.com/your-orders/orders\n${stamp} · https://www.amazon.com/\n`,
    );
  });
});

describe("errors", () => {
  it("an unavailable browser explains the desktop app, whatever the command", async () => {
    // The fake's default answer: a server outside the desktop app.
    server.builtinBrowser = () => ({
      status: 503,
      body: {
        error: { code: "browser_unavailable", message: "not here", reason: "shell_unsupported" },
      },
    });
    expect(await cli(["browser", "scan"])).toBe(1);
    expect(err()).toBe(
      `error: browser_unavailable: ${t.browser.unavailableHint("shell_unsupported")}\n`,
    );
    expect(out()).toBe("");
  });

  it("reads the flat error body too: {error: code, reason}", async () => {
    server.builtinBrowser = () => ({
      status: 503,
      body: { error: "browser_unavailable", reason: "no_window" },
    });
    expect(await cli(["browser", "tabs"])).toBe(1);
    expect(err()).toBe(`error: browser_unavailable: ${t.browser.unavailableHint("no_window")}\n`);
  });

  it("any other API error is one line with the server's code and message", async () => {
    routes["POST /tabs/99/exec"] = () => ({
      status: 404,
      body: { error: { code: "no_such_tab", message: "No tab 99." } },
    });
    expect(await cli(["browser", "exec", "return 1", "--tab", "99", "--json"])).toBe(1);
    expect(err()).toBe("error: no_such_tab: No tab 99.\n");
    expect(out()).toBe("");
  });

  it("no server running means the desktop app is not running; nothing is auto-started", async () => {
    delete process.env.PENGUIN_API_URL;
    expect(await cli(["browser", "tabs"])).toBe(1);
    expect(err()).toBe(`error: browser_unavailable: ${t.browser.unavailableHint(undefined)}\n`);
    expect(server.requests).toEqual([]);
  });
});

describe("output in Chinese", () => {
  it("labels the exec lines in the zh dictionary", () => {
    const zh = getMessages("zh");
    expect(
      renderExec(execResult({ value: 3, diff: { changed: 2 }, transients: ["已加入购物车"] }), zh, {
        alwaysReturn: true,
      }),
    ).toBe(
      '状态：success   标签页：12\n返回值：3\n变化：2 个元素有变化\n瞬时提示："已加入购物车"\n',
    );
  });
});
