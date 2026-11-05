/**
 * CDP on a driven tab through chrome.debugger.
 *
 * - Given a tab nobody debugs, the first command attaches once (protocol 1.3), and commands
 *   sent at the same moment share that one attach.
 * - Given `events` on a command, only those CDP events of the tab are relayed, until a later
 *   command names others; a command without `events` keeps the list; out-of-process frames'
 *   events are never relayed.
 * - Given a minute without commands, the tab is detached (the infobar can go); the next command
 *   attaches again, and a command still running is never detached under.
 * - Given a command that arrives while the idle detach runs, it waits for it and attaches again.
 * - Given the infobar's Cancel, every driven tab is released to its server, and nothing attaches
 *   again on its own.
 * - Given a page Chrome does not let extensions debug, the tab is released as `restricted` and
 *   never attached.
 * - Given a cookie, storage, browser or file method, or a navigation to a local page, nothing
 *   reaches Chrome.
 * - Given a tab that navigated to a restricted page under the debugger, it is released; a
 *   closed tab is left to the tab events.
 * - Given a session left attached by a previous worker, the command runs on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Debuggee, type DebuggeeOptions } from "../src/debuggee.js";
import type { TabReleaseReason } from "../src/wire.js";
import { installChrome, type FakeChrome } from "./helpers/chrome.js";

let fake: FakeChrome;
let windowId: number;

function debuggee(overrides: Partial<DebuggeeOptions> = {}) {
  const relayed: { tabId: number; method: string; params: object }[] = [];
  const released: { tabIds: readonly number[] | "all"; reason: TabReleaseReason }[] = [];
  const instance = new Debuggee({
    event: (tabId, method, params) => relayed.push({ tabId, method, params }),
    release: (tabIds, reason) => released.push({ tabIds, reason }),
    ...overrides,
  });
  const stop = instance.listen();
  return { debuggee: instance, relayed, released, stop };
}

function webTab(url = "https://shop.example.com/orders") {
  return fake.openTab({ windowId, url }).id;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake = installChrome();
  windowId = fake.addWindow().id;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("attaching", () => {
  it("attaches once for the first commands and returns each result", async () => {
    const tab = webTab();
    fake.respond = (call) => ({ echo: call.method });
    const { debuggee: d } = debuggee();
    const results = await Promise.all([
      d.send(tab, "Runtime.evaluate", { expression: "1" }),
      d.send(tab, "Page.getLayoutMetrics"),
    ]);
    expect(results).toEqual([{ echo: "Runtime.evaluate" }, { echo: "Page.getLayoutMetrics" }]);
    expect(fake.attaches).toEqual([tab]);
  });

  it("runs on a session a previous worker left attached", async () => {
    const tab = webTab();
    fake.attached.add(tab);
    const { debuggee: d } = debuggee();
    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    expect(fake.commands.map((c) => c.method)).toEqual(["Runtime.evaluate"]);
  });
});

describe("relayed events", () => {
  it("relays only the events the last command named", async () => {
    const tab = webTab();
    const { debuggee: d, relayed } = debuggee();
    await d.send(tab, "Page.enable", {}, ["Page.javascriptDialogOpening"]);
    fake.events.debuggerEvent.fire({ tabId: tab }, "Page.javascriptDialogOpening", {
      message: "Sure?",
    });
    fake.events.debuggerEvent.fire({ tabId: tab }, "Page.frameNavigated", {});
    fake.events.debuggerEvent.fire(
      { tabId: tab, sessionId: "child" },
      "Page.javascriptDialogOpening",
      {},
    );

    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    fake.events.debuggerEvent.fire({ tabId: tab }, "Page.javascriptDialogOpening", {
      message: "Again",
    });

    await d.send(tab, "Page.disable", {}, []);
    fake.events.debuggerEvent.fire({ tabId: tab }, "Page.javascriptDialogOpening", {
      message: "Gone",
    });

    expect(relayed).toEqual([
      { tabId: tab, method: "Page.javascriptDialogOpening", params: { message: "Sure?" } },
      { tabId: tab, method: "Page.javascriptDialogOpening", params: { message: "Again" } },
    ]);
  });
});

describe("detaching when idle", () => {
  it("detaches after a minute without commands, and the next command attaches again", async () => {
    const tab = webTab();
    const { debuggee: d } = debuggee();
    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fake.attached.has(tab)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.attached.has(tab)).toBe(false);

    await d.send(tab, "Runtime.evaluate", { expression: "2" });
    expect(fake.attaches).toEqual([tab, tab]);
  });

  it("never detaches a tab while a command is still running on it", async () => {
    const tab = webTab();
    let finish: (value: unknown) => void = () => {};
    fake.respond = (call) =>
      call.method === "Runtime.evaluate" ? new Promise((resolve) => (finish = resolve)) : {};
    const { debuggee: d } = debuggee();
    await d.send(tab, "Page.enable");
    const slow = d.send(tab, "Runtime.evaluate", { expression: "await longTask()" });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fake.attached.has(tab)).toBe(true);
    finish({ result: { value: 1 } });
    await expect(slow).resolves.toEqual({ result: { value: 1 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.attached.has(tab)).toBe(false);
  });

  it("a command arriving during the idle detach waits for it and attaches again", async () => {
    const tab = webTab();
    const { debuggee: d } = debuggee();
    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    let open: () => void = () => {};
    fake.detachGate = new Promise((resolve) => (open = resolve));
    await vi.advanceTimersByTimeAsync(60_000);

    const next = d.send(tab, "Runtime.evaluate", { expression: "2" });
    open();
    await expect(next).resolves.toEqual({});
    expect(fake.detaches).toEqual([tab]);
    expect(fake.attaches).toEqual([tab, tab]);
    expect(fake.commands.map((c) => c.params)).toEqual([{ expression: "1" }, { expression: "2" }]);
  });
});

describe("the user's Cancel on the infobar", () => {
  it("releases every driven tab and attaches nothing again by itself", async () => {
    const one = webTab();
    const two = webTab("https://mail.example.com/");
    const { debuggee: d, released } = debuggee();
    await d.send(one, "Runtime.evaluate", { expression: "1" });
    await d.send(two, "Runtime.evaluate", { expression: "1" });

    // Chrome detaches every session of the extension, one event per tab.
    fake.attached.clear();
    fake.events.debuggerDetach.fire({ tabId: one }, "canceled_by_user");
    fake.events.debuggerDetach.fire({ tabId: two }, "canceled_by_user");
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(released[0]).toEqual({ tabIds: "all", reason: "user" });
    expect(fake.attaches).toEqual([one, two]);
  });
});

describe("pages the extension may not drive", () => {
  it("releases a chrome:// tab as restricted instead of attaching", async () => {
    const tab = webTab("chrome://settings/");
    const { debuggee: d, released } = debuggee();
    await expect(d.send(tab, "Runtime.evaluate", { expression: "1" })).rejects.toThrow(
      "tab_released",
    );
    expect(released).toEqual([{ tabIds: [tab], reason: "restricted" }]);
    expect(fake.attaches).toEqual([]);
  });

  it.each([
    ["the browser's cookie jar", "Network.getAllCookies", {}],
    ["a cookie write", "Network.setCookie", { name: "sid", value: "x" }],
    ["site storage", "Storage.getCookies", {}],
    ["another target", "Target.attachToTarget", { targetId: "x" }],
    ["the browser", "Browser.close", {}],
    ["local files on an input", "DOM.setFileInputFiles", { files: ["/etc/passwd"] }],
  ])("refuses %s before it reaches Chrome", async (_name, method, params) => {
    const tab = webTab();
    const { debuggee: d } = debuggee();
    await expect(d.send(tab, method, params)).rejects.toThrow("cdp_refused");
    expect(fake.attaches).toEqual([]);
    expect(fake.commands).toEqual([]);
  });

  it("refuses a navigation to a local page", async () => {
    const tab = webTab();
    const { debuggee: d } = debuggee();
    await expect(d.send(tab, "Page.navigate", { url: "file:///etc/passwd" })).rejects.toThrow(
      "bad_url",
    );
    await d.send(tab, "Page.navigate", { url: "https://example.com/" });
    expect(fake.commands.map((c) => c.params)).toEqual([{ url: "https://example.com/" }]);
  });

  it("releases a tab that navigated to a restricted page under the debugger", async () => {
    const tab = webTab();
    const { debuggee: d, released } = debuggee();
    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    fake.tabs.get(tab)!.url = "chrome://downloads/";
    fake.attached.delete(tab);
    fake.events.debuggerDetach.fire({ tabId: tab }, "target_closed");
    await vi.waitFor(() => expect(released).toEqual([{ tabIds: [tab], reason: "restricted" }]));
  });

  it("leaves a closed tab to the tab events", async () => {
    const tab = webTab();
    const { debuggee: d, released } = debuggee();
    await d.send(tab, "Runtime.evaluate", { expression: "1" });
    fake.closeTab(tab);
    fake.events.debuggerDetach.fire({ tabId: tab }, "target_closed");
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toEqual([]);
  });
});
