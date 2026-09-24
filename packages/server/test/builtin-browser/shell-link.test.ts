/**
 * The shell link over a fake parentPort: request / reply by id, the per-request timeout, the
 * hello handshake (and a shell too old to answer it), event fan-out, and disposal taking the
 * listener off the port — the hot-swap guarantee.
 */
import { describe, expect, it } from "vitest";
import type { DesktopBrowserCommandMessage } from "../../src/api/types.js";
import {
  ShellLink,
  ShellLinkError,
  parseBrowserEvent,
  parseBrowserReply,
  parseTab,
} from "../../src/builtin-browser/shell-link.js";
import { FakePort, FakeShell, tab } from "./fake-shell.js";

const lastCommand = (port: FakePort) => port.sent.at(-1) as DesktopBrowserCommandMessage;

describe("ShellLink requests", () => {
  it("sends a command frame and resolves with the reply to its id", async () => {
    const port = new FakePort();
    const link = new ShellLink(port);
    const pending = link.request({ op: "tabs" });
    const frame = lastCommand(port);
    expect(frame.type).toBe("desktop-browser-command");
    expect(frame.command).toEqual({ op: "tabs" });
    // A reply to someone else's id, and frames of other relays, are ignored.
    port.emit({ type: "desktop-browser-reply", id: "not-mine", ok: true, result: 1 });
    port.emit({ type: "desktop-updater-status", status: {} });
    port.emit({ type: "desktop-browser-reply", id: frame.id, ok: true, result: { tabs: [] } });
    await expect(pending).resolves.toEqual({ tabs: [] });
    link.dispose();
  });

  it("gives each request its own id, and each generation its own prefix", () => {
    const port = new FakePort();
    const a = new ShellLink(port);
    const b = new ShellLink(port);
    void a.request({ op: "tabs" }).catch(() => {});
    void a.request({ op: "tabs" }).catch(() => {});
    void b.request({ op: "tabs" }).catch(() => {});
    const ids = port.sent.map((m) => (m as DesktopBrowserCommandMessage).id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]!.split("-")[0]).toBe(ids[1]!.split("-")[0]);
    expect(ids[0]!.split("-")[0]).not.toBe(ids[2]!.split("-")[0]);
    a.dispose();
    b.dispose();
  });

  it("rejects with the shell's error when it refuses", async () => {
    const port = new FakePort();
    const link = new ShellLink(port);
    const pending = link.request({ op: "cdp", tabId: 3, method: "Page.reload" });
    port.emit({
      type: "desktop-browser-reply",
      id: lastCommand(port).id,
      ok: false,
      error: "no_such_tab",
    });
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShellLinkError);
    expect((err as ShellLinkError).kind).toBe("refused");
    expect((err as ShellLinkError).message).toBe("no_such_tab");
    link.dispose();
  });

  it("times out a request the shell never answers", async () => {
    const port = new FakePort();
    const link = new ShellLink(port);
    const err = await link.request({ op: "tabs" }, 30).catch((e: unknown) => e);
    expect((err as ShellLinkError).kind).toBe("timeout");
    // A reply after the deadline changes nothing.
    port.emit({ type: "desktop-browser-reply", id: lastCommand(port).id, ok: true, result: {} });
    link.dispose();
  });

  it("fails what is pending and leaves the port when disposed", async () => {
    const port = new FakePort();
    const link = new ShellLink(port);
    expect(port.listenerCount).toBe(1);
    const pending = link.request({ op: "tabs" });
    link.dispose();
    expect(port.listenerCount).toBe(0);
    expect(((await pending.catch((e: unknown) => e)) as ShellLinkError).kind).toBe("closed");
    expect(
      ((await link.request({ op: "tabs" }).catch((e: unknown) => e)) as ShellLinkError).kind,
    ).toBe("closed");
  });

  it("falls back to removeListener on a port without off", () => {
    const port = new FakePort();
    const bare = {
      on: port.on.bind(port),
      postMessage: port.postMessage.bind(port),
      removeListener: port.off.bind(port),
    };
    const link = new ShellLink(bare);
    expect(port.listenerCount).toBe(1);
    link.dispose();
    expect(port.listenerCount).toBe(0);
  });
});

describe("ShellLink handshake", () => {
  it("connects on hello and runs the connect listeners before resolving", async () => {
    const shell = new FakeShell();
    const link = new ShellLink(shell.port);
    const order: string[] = [];
    link.onConnect(async () => {
      order.push("refresh");
    });
    expect(link.connected).toBe(false);
    await expect(link.handshake()).resolves.toBe(true);
    expect(order).toEqual(["refresh"]);
    expect(link.connected).toBe(true);
    // Once connected, no further hello is sent.
    await link.handshake(true);
    expect(shell.commands.filter((c) => c.op === "hello")).toHaveLength(1);
    link.dispose();
  });

  it("shares one hello between concurrent callers", async () => {
    const shell = new FakeShell();
    const link = new ShellLink(shell.port);
    const results = await Promise.all([link.handshake(), link.handshake(), link.handshake(true)]);
    expect(results).toEqual([true, true, true]);
    expect(shell.commands.filter((c) => c.op === "hello")).toHaveLength(1);
    link.dispose();
  });

  it("treats a silent shell as unsupported, answers from that for a while, and retries when forced", async () => {
    const shell = new FakeShell();
    shell.speaksBrowser = false;
    let now = 1_000;
    const link = new ShellLink(shell.port, { helloTimeoutMs: 20, helloRetryMs: 10_000 }, () => now);
    await expect(link.handshake()).resolves.toBe(false);
    const hellos = () => shell.port.sent.length;
    const sent = hellos();
    // Within the retry window a plain handshake does not ask again…
    await expect(link.handshake()).resolves.toBe(false);
    expect(hellos()).toBe(sent);
    // …a forced one (the status route) does, and a shell that now answers connects.
    shell.speaksBrowser = true;
    await expect(link.handshake(true)).resolves.toBe(true);
    link.dispose();

    const later = new FakeShell();
    later.speaksBrowser = false;
    const again = new ShellLink(
      later.port,
      { helloTimeoutMs: 20, helloRetryMs: 10_000 },
      () => now,
    );
    await again.handshake();
    later.speaksBrowser = true;
    now += 10_001;
    await expect(again.handshake()).resolves.toBe(true);
    again.dispose();
  });
});

describe("ShellLink events", () => {
  it("fans validated events out to every listener, and drops malformed ones", () => {
    const shell = new FakeShell();
    const link = new ShellLink(shell.port);
    const a: unknown[] = [];
    const b: unknown[] = [];
    link.onEvent((e) => a.push(e));
    const unsubscribe = link.onEvent((e) => b.push(e));
    shell.show(tab(5));
    shell.port.emit({ type: "desktop-browser-event", event: { kind: "tab", tab: { id: "x" } } });
    shell.port.emit({ type: "desktop-browser-event", event: { kind: "mystery" } });
    unsubscribe();
    shell.close(5);
    expect(a).toEqual([
      { kind: "tab", tab: tab(5) },
      { kind: "tab-closed", tabId: 5 },
    ]);
    expect(b).toEqual([{ kind: "tab", tab: tab(5) }]);
    link.dispose();
  });
});

describe("wire parsing", () => {
  it("reads tabs strictly and keeps only a non-empty favicon", () => {
    expect(parseTab(tab(1, { favicon: "https://a.test/f.ico" }))).toEqual(
      tab(1, { favicon: "https://a.test/f.ico" }),
    );
    expect(parseTab({ ...tab(1), favicon: "" })).toEqual(tab(1));
    expect(parseTab({ ...tab(1), loading: "no" })).toBeNull();
    expect(parseTab({ ...tab(1), id: 1.5 })).toBeNull();
  });

  it("reads open requests, background included", () => {
    expect(
      parseBrowserEvent({
        type: "desktop-browser-event",
        event: { kind: "open-request", url: "https://a.test/", openerTabId: 2, background: true },
      }),
    ).toEqual({ kind: "open-request", url: "https://a.test/", openerTabId: 2, background: true });
    expect(
      parseBrowserEvent({
        type: "desktop-browser-event",
        event: { kind: "open-request", url: "https://a.test/", openerTabId: 2, background: "yes" },
      }),
    ).toEqual({ kind: "open-request", url: "https://a.test/", openerTabId: 2 });
  });

  it("reads a relayed CDP event, its params an object whatever arrived", () => {
    const event = (value: Record<string, unknown>) =>
      parseBrowserEvent({ type: "desktop-browser-event", event: { kind: "cdp-event", ...value } });
    const params = { type: "confirm", message: "Delete?" };
    expect(event({ tabId: 3, method: "Page.javascriptDialogOpening", params })).toEqual({
      kind: "cdp-event",
      tabId: 3,
      method: "Page.javascriptDialogOpening",
      params,
    });
    expect(event({ tabId: 3, method: "Page.frameNavigated", params: null })).toEqual({
      kind: "cdp-event",
      tabId: 3,
      method: "Page.frameNavigated",
      params: {},
    });
    expect(event({ tabId: "3", method: "Page.frameNavigated" })).toBeNull();
  });

  it("reads replies and ignores everything else", () => {
    expect(
      parseBrowserReply({ type: "desktop-browser-reply", id: "1", ok: true, result: 2 }),
    ).toEqual({
      type: "desktop-browser-reply",
      id: "1",
      ok: true,
      result: 2,
    });
    expect(parseBrowserReply({ type: "desktop-browser-reply", id: 1, ok: true })).toBeNull();
    expect(parseBrowserReply({ type: "desktop-tray-status" })).toBeNull();
  });
});
