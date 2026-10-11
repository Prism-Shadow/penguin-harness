/**
 * HostedLink against a fake CDP pipe (fake-cdp.ts):
 *
 * - Each link command becomes the right CDP calls: hello, tabs, open-tab, close-tab,
 *   activate-tab, cdp.
 * - Target events become the link's: tab, tab-closed, tab-crashed; a popup is a tab too.
 * - Chrome starts with the first command, not before; with no tab for a while it is stopped.
 * - A Chrome that exits fails what waits as `closed`, takes its tabs, and tells the disconnect
 *   listeners; the next command starts another.
 * - A launch that fails says why: no Chrome on the machine, or Chrome's own error line.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { BuiltinBrowserTab, DesktopBrowserEvent } from "../../src/api/types.js";
import { HostedLink } from "../../src/builtin-browser/hosted-link.js";
import type { HostedLinkTiming } from "../../src/builtin-browser/hosted-link.js";
import { BrowserLinkError } from "../../src/builtin-browser/link.js";
import { FakeChromeHost } from "./fake-cdp.js";

const links: HostedLink[] = [];
afterEach(() => {
  for (const link of links.splice(0)) link.dispose();
});

function setup(timing: Partial<HostedLinkTiming> = {}) {
  const host = new FakeChromeHost();
  const logs: string[] = [];
  const events: DesktopBrowserEvent[] = [];
  const link = new HostedLink({
    chrome: () => host.find(null),
    launch: (chromePath) => host.launch(chromePath, "/data/builtin-browser/hosted-profile"),
    log: (line) => logs.push(line),
    timing: { startTimeoutMs: 200, ...timing },
  });
  links.push(link);
  link.onEvent((event) => events.push(event));
  return { host, link, logs, events };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}
/** The last command of `method` the fake Chrome was sent. */
const lastSent = (host: FakeChromeHost, method: string) =>
  host.chrome.sent.findLast((command) => command.method === method);
const openTab = async (link: HostedLink, url: string) =>
  ((await link.request({ op: "open-tab", url, activate: true })) as { tab: BuiltinBrowserTab }).tab;
const linkError = async (run: Promise<unknown>): Promise<BrowserLinkError> => {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof BrowserLinkError))
    throw new Error(`expected a link error, got ${String(err)}`);
  return err;
};

describe("commands", () => {
  it("starts Chrome with the first command, and answers hello with its version", async () => {
    const { host, link } = setup();
    expect(link.connected).toBe(false);
    expect(host.launched).toHaveLength(0);

    expect(await link.request({ op: "hello" })).toEqual({
      version: 1,
      backend: "hosted",
      chrome: "140.0.7339.16",
    });
    expect(host.launched).toHaveLength(1);
    expect(link.connected).toBe(true);
    expect(link.version).toBe("140.0.7339.16");
    expect(host.chrome.methods()).toEqual(["Browser.getVersion", "Target.setDiscoverTargets"]);
    // Running already: nothing is launched twice.
    await link.request({ op: "tabs" });
    expect(host.launched).toHaveLength(1);
  });

  it("opens a tab as a page target in its own window, attached flat, then navigated", async () => {
    const { host, link, events } = setup();
    const tab = await openTab(link, "https://example.test/a");
    expect(tab).toEqual({
      id: 1,
      url: "https://example.test/a",
      title: "Title of https://example.test/a",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    const sent = host.chrome.sent;
    const created = sent.find((c) => c.method === "Target.createTarget");
    expect(created?.params).toMatchObject({ url: "about:blank", newWindow: true });
    expect(sent.find((c) => c.method === "Target.attachToTarget")?.params).toEqual({
      targetId: "T1",
      flatten: true,
    });
    const navigate = sent.find((c) => c.method === "Page.navigate");
    expect(navigate).toMatchObject({
      params: { url: "https://example.test/a" },
      sessionId: "S-T1",
    });
    // Its events are on before the address is asked for.
    const methods = host.chrome.methods();
    expect(methods.indexOf("Page.enable")).toBeLessThan(methods.indexOf("Page.navigate"));
    // Announced once attached, and again as it loaded.
    expect(events[0]).toEqual({
      kind: "tab",
      tab: {
        id: 1,
        url: "about:blank",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    expect(events.at(-1)).toEqual({ kind: "tab", tab });
    expect(await link.request({ op: "tabs" })).toEqual({ tabs: [tab] });
  });

  it("closes and activates a tab by its target, and refuses a tab it does not have", async () => {
    const { host, link, events } = setup();
    const tab = await openTab(link, "about:blank");
    await link.request({ op: "activate-tab", tabId: tab.id });
    expect(lastSent(host, "Target.activateTarget")?.params).toEqual({ targetId: "T1" });
    await link.request({ op: "close-tab", tabId: tab.id });
    expect(lastSent(host, "Target.closeTarget")?.params).toEqual({ targetId: "T1" });
    expect(events.at(-1)).toEqual({ kind: "tab-closed", tabId: tab.id });
    expect(await link.request({ op: "tabs" })).toEqual({ tabs: [] });

    for (const command of [
      { op: "close-tab", tabId: tab.id },
      { op: "activate-tab", tabId: 99 },
      { op: "cdp", tabId: tab.id, method: "Page.reload" },
    ] as const) {
      const err = await linkError(link.request(command));
      expect([err.kind, err.message]).toEqual(["refused", "no_such_tab"]);
    }
  });

  it("sends cdp to the tab's session, relays the events asked for, and passes Chrome's refusal on", async () => {
    const { host, link, events } = setup();
    const tab = await openTab(link, "https://example.test/");
    host.chrome.cdp = (method) => {
      if (method === "Runtime.evaluate") return { result: { type: "number", value: 2 } };
      if (method === "DOM.getDocument") throw new Error("DOM agent is not enabled");
      return undefined;
    };
    expect(
      await link.request({
        op: "cdp",
        tabId: tab.id,
        method: "Runtime.evaluate",
        params: { expression: "1+1" },
        events: ["Page.javascriptDialogOpening"],
      }),
    ).toEqual({ result: { type: "number", value: 2 } });
    expect(lastSent(host, "Runtime.evaluate")).toMatchObject({
      params: { expression: "1+1" },
      sessionId: "S-T1",
    });
    const err = await linkError(
      link.request({ op: "cdp", tabId: tab.id, method: "DOM.getDocument" }),
    );
    expect([err.kind, err.message]).toEqual(["refused", "DOM agent is not enabled"]);

    // A relayed event reaches the action that asked for it, and is left for it to answer.
    host.chrome.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Sure?" }, "S-T1");
    host.chrome.emit("Page.loadEventFired", { timestamp: 1 }, "S-T1");
    await flush();
    expect(events.filter((e) => e.kind === "cdp-event")).toEqual([
      {
        kind: "cdp-event",
        tabId: tab.id,
        method: "Page.javascriptDialogOpening",
        params: { type: "confirm", message: "Sure?" },
      },
    ]);
    expect(host.chrome.methods()).not.toContain("Page.handleJavaScriptDialog");
  });

  it("answers a dialog nobody watches for, so the page is not left blocked", async () => {
    const { host, link } = setup();
    await openTab(link, "https://example.test/");
    const answers = () =>
      host.chrome.sent
        .filter((c) => c.method === "Page.handleJavaScriptDialog")
        .map((c) => c.params.accept);
    host.chrome.emit("Page.javascriptDialogOpening", { type: "alert", message: "Hi" }, "S-T1");
    host.chrome.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Sure?" }, "S-T1");
    host.chrome.emit("Page.javascriptDialogOpening", { type: "beforeunload", message: "" }, "S-T1");
    expect(answers()).toEqual([true, false, true]);
  });
});

describe("target events", () => {
  it("turns a popup into a tab, and a target's changes into tab events", async () => {
    const { host, link, events } = setup();
    await openTab(link, "https://example.test/");
    events.length = 0;

    const popup = host.chrome.popup("https://example.test/popup");
    await until(() => events.some((e) => e.kind === "tab"), "the popup's tab");
    expect(events[0]).toMatchObject({
      kind: "tab",
      tab: { id: 2, url: "https://example.test/popup" },
    });
    expect(lastSent(host, "Page.enable")?.sessionId).toBe(`S-${popup}`);

    events.length = 0;
    host.chrome.emit("Page.frameStartedLoading", { frameId: popup }, `S-${popup}`);
    // A subframe's loading is not the tab's.
    host.chrome.emit("Page.frameStartedLoading", { frameId: "subframe" }, `S-${popup}`);
    host.chrome.emit("Target.targetInfoChanged", {
      targetInfo: {
        targetId: popup,
        type: "page",
        url: "https://example.test/next",
        title: "Next",
      },
    });
    expect(events).toEqual([
      { kind: "tab", tab: expect.objectContaining({ id: 2, loading: true }) },
      {
        kind: "tab",
        tab: expect.objectContaining({ id: 2, url: "https://example.test/next", title: "Next" }),
      },
    ]);

    // Its history says whether there is somewhere to go back to, and what the page calls
    // itself: Chrome announces no change of title.
    host.chrome.cdp = (method) =>
      method === "Page.getNavigationHistory"
        ? { currentIndex: 1, entries: [{ id: 1 }, { id: 2, title: "Named late" }] }
        : undefined;
    host.chrome.emit("Page.frameStoppedLoading", { frameId: popup }, `S-${popup}`);
    await until(
      () => events.some((e) => e.kind === "tab" && e.tab.canGoBack),
      "the history to be read",
    );
    expect(events.at(-1)).toMatchObject({
      kind: "tab",
      tab: { id: 2, title: "Named late", loading: false, canGoBack: true, canGoForward: false },
    });

    events.length = 0;
    host.chrome.emit("Target.targetDestroyed", { targetId: popup });
    expect(events).toEqual([{ kind: "tab-closed", tabId: 2 }]);
    // Targets that are not pages are no tabs.
    host.chrome.emit("Target.targetCreated", {
      targetInfo: { targetId: "W1", type: "service_worker", url: "https://example.test/sw.js" },
    });
    await flush();
    expect(await link.request({ op: "tabs" })).toMatchObject({ tabs: [{ id: 1 }] });
  });

  it("marks a crashed tab, refuses commands for it, and clears the mark when it reloads", async () => {
    const { host, link, events } = setup();
    const tab = await openTab(link, "https://example.test/");
    events.length = 0;
    host.chrome.emit("Target.targetCrashed", { targetId: "T1", status: "crashed", errorCode: 11 });
    expect(events).toEqual([
      { kind: "tab", tab: expect.objectContaining({ id: tab.id, crashed: "crashed" }) },
      { kind: "tab-crashed", tabId: tab.id, reason: "crashed", exitCode: 11 },
    ]);
    const err = await linkError(link.request({ op: "cdp", tabId: tab.id, method: "Page.enable" }));
    expect([err.kind, err.message]).toEqual(["refused", "tab_crashed"]);

    host.chrome.emit("Page.frameNavigated", { frame: { id: "T1", url: tab.url } }, "S-T1");
    const reloaded = events.findLast((e) => e.kind === "tab");
    expect(reloaded?.kind === "tab" && "crashed" in reloaded.tab).toBe(false);
    expect(await link.request({ op: "cdp", tabId: tab.id, method: "Page.enable" })).toEqual({});
  });
});

describe("Chrome's lifetime", () => {
  it("fails what waits as closed when Chrome exits, drops its tabs, and starts another for the next command", async () => {
    const { host, link, logs } = setup();
    let disconnects = 0;
    link.onDisconnect(() => {
      disconnects += 1;
    });
    const tab = await openTab(link, "https://example.test/");
    const first = host.chrome;
    // A command Chrome never answers.
    first.cdp = (method) => (method === "Runtime.evaluate" ? new Promise(() => {}) : undefined);
    const waiting = linkError(
      link.request({ op: "cdp", tabId: tab.id, method: "Runtime.evaluate", params: {} }),
    );
    await flush();
    first.exit(null, "SIGKILL");

    expect((await waiting).kind).toBe("closed");
    expect(disconnects).toBe(1);
    expect(link.connected).toBe(false);
    expect(logs.some((line) => /Chrome exited \(SIGKILL\)/.test(line))).toBe(true);

    // The next command launches a new Chrome, which has none of the old one's tabs.
    expect(await link.request({ op: "tabs" })).toEqual({ tabs: [] });
    expect(host.launched).toHaveLength(2);
    expect(link.connected).toBe(true);
    // A tab id is never given twice, so the old one cannot name a new tab.
    expect((await openTab(link, "https://example.test/")).id).toBe(tab.id + 1);
  });

  it("stops Chrome after it held no tab for the idle time, and not while it holds one", async () => {
    const { host, link } = setup({ idleExitMs: 30 });
    let disconnects = 0;
    link.onDisconnect(() => {
      disconnects += 1;
    });
    const tab = await openTab(link, "https://example.test/");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(host.chrome.killed).toBe(false);

    await link.request({ op: "close-tab", tabId: tab.id });
    await until(() => host.chrome.killed, "the idle stop");
    expect(link.connected).toBe(false);
    expect(disconnects).toBe(1);

    await link.request({ op: "hello" });
    expect(host.launched).toHaveLength(2);
  });

  it("kills Chrome when the link is disposed, and starts none after that", async () => {
    const { host, link } = setup();
    await link.request({ op: "hello" });
    link.dispose();
    expect(host.chrome.killed).toBe(true);
    expect(await link.handshake()).toBe(false);
    expect((await linkError(link.request({ op: "tabs" }))).kind).toBe("closed");
    expect(host.launched).toHaveLength(1);
  });
});

describe("a launch that fails", () => {
  it("is hosted_no_chrome when the machine has none", async () => {
    const { host, link } = setup();
    host.path = null;
    expect(await link.handshake()).toBe(false);
    expect(link.unavailability()).toEqual({ reason: "hosted_no_chrome" });
    expect(host.launched).toHaveLength(0);
    // Installed since: the next handshake finds it.
    host.path = "/fake/bin/chrome";
    expect(await link.handshake()).toBe(true);
    expect(link.failure).toBeNull();
  });

  it("is hosted_launch_failed with Chrome's own error line when it exits at startup", async () => {
    const { host, link, logs } = setup();
    host.prepare = (chrome) => {
      chrome.startup = "exit";
      chrome.printed =
        "[100:100:1004/120000.000000:WARNING:foo.cc(1)] something minor\n" +
        "[100:100:1004/120000.100000:ERROR:zygote_host_impl_linux.cc(101)] Running as root without --no-sandbox is not supported. See https://crbug.com/638180.\n";
    };
    expect(await link.handshake()).toBe(false);
    expect(link.unavailability()).toEqual({
      reason: "hosted_launch_failed",
      detail:
        "Running as root without --no-sandbox is not supported. See https://crbug.com/638180.",
    });
    expect(link.failure?.chromePath).toBe("/fake/bin/chrome");
    expect(logs.some((line) => line.includes("did not start"))).toBe(true);
    // Each handshake tries again; one that works clears the failure.
    host.prepare = () => {};
    expect(await link.handshake()).toBe(true);
    expect(link.failure).toBeNull();
    expect(host.launched).toHaveLength(2);
  });

  it("is hosted_launch_failed when Chrome never answers, and that Chrome is killed", async () => {
    const { host, link } = setup({ startTimeoutMs: 30 });
    host.prepare = (chrome) => {
      chrome.startup = "hang";
    };
    expect(await link.handshake()).toBe(false);
    expect(link.unavailability()).toEqual({
      reason: "hosted_launch_failed",
      detail: "Chrome did not answer 'Browser.getVersion' within 0s.",
    });
    expect(host.chrome.killed).toBe(true);
  });
});
