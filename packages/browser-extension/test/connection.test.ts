/**
 * A paired server's link, as the server sees it on the wire.
 *
 * - Given a paired server, the extension dials its WebSocket path offering `penguin-browser.1`
 *   and `token.<token>`, and the token never appears in the URL.
 * - Given the server's `hello`, the reply is the extension's BrowserHello and the link counts as
 *   connected; no event goes out before that.
 * - Given a `ping`, the reply is `{}` and no command handler runs.
 * - Given a command, the handler's result (or its refusal) comes back under the command's id;
 *   a malformed command answers `bad_command`, an op the extension does not run `unknown_op`,
 *   and a frame that is no command is ignored.
 * - Given a dropped socket, the link redials after 1, 2, 4 … 60 s, and a successful `hello`
 *   starts the schedule over.
 * - Given `4001 replaced`, it does not redial until the user reconnects; a hold restored from
 *   storage keeps it from dialling at start.
 * - Given `4003 revoked`, it never redials.
 * - Given `4005` (or a server that selects no subprotocol), it waits for an update.
 * - Given `4009 disabled`, it asks again after an hour, not before — not even on the alarm.
 * - Given a minute without a frame, it closes the dead socket and redials.
 * - Given two paired servers, a close on one leaves the other's link and commands untouched.
 * - Given a command that arrived on a socket since replaced, its late answer is not sent on the
 *   new socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerConnection, type ServerConnectionOptions } from "../src/connection.js";
import type { ConnectionState, Hold } from "../src/storage.js";
import type { BrowserHello, DesktopBrowserCommand } from "../src/wire.js";
import { socketFactory, type FakeSocket } from "./helpers/socket.js";

const HELLO: BrowserHello = {
  version: 1,
  backend: "chrome",
  extension: { version: "0.2.13", chrome: "130.0.6723.58", name: "Chrome 130 on Linux" },
};

const TOKEN = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno";

function link(overrides: Partial<ServerConnectionOptions> = {}) {
  const factory = socketFactory();
  const states: ConnectionState[] = [];
  const holds: (Hold | null)[] = [];
  const handled: DesktopBrowserCommand[] = [];
  const connection = new ServerConnection({
    origin: "https://ph.example.com",
    token: TOKEN,
    handle: async (command) => {
      handled.push(command);
      return { ran: command.op };
    },
    hello: () => HELLO,
    onState: (state, hold) => {
      states.push(state);
      holds.push(hold);
    },
    createSocket: factory.create,
    ...overrides,
  });
  return { connection, factory, states, holds, handled };
}

/** Dials, accepts and says hello: a connected link. */
function connected(overrides: Partial<ServerConnectionOptions> = {}) {
  const parts = link(overrides);
  parts.connection.start();
  parts.factory.last.accept();
  parts.factory.last.command("h1", { op: "hello" });
  return parts;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dialling and the handshake", () => {
  it("offers the protocol and the token as subprotocols, never in the URL", () => {
    const { connection, factory } = link();
    connection.start();
    const socket = factory.last;
    expect(socket.url).toBe("wss://ph.example.com/api/builtin-browser/extension/ws");
    expect(socket.protocols).toEqual(["penguin-browser.1", `token.${TOKEN}`]);
    expect(socket.url).not.toContain(TOKEN);
  });

  it("dials ws:// for a plain-http server such as the desktop's loopback one", () => {
    const { connection, factory } = link({ origin: "http://localhost:7369" });
    connection.start();
    expect(factory.last.url).toBe("ws://localhost:7369/api/builtin-browser/extension/ws");
  });

  it("answers hello with the extension's hello and only then sends events", () => {
    const { connection, factory, states } = link();
    connection.start();
    const socket = factory.last;
    socket.accept();
    expect(connection.emit({ kind: "tab-closed", tabId: 1 })).toBe(false);

    socket.command("h1", { op: "hello" });
    expect(socket.reply("h1")).toEqual({
      type: "desktop-browser-reply",
      id: "h1",
      ok: true,
      result: HELLO,
    });
    expect(states.at(-1)?.status).toBe("connected");
    expect(connection.emit({ kind: "tab-closed", tabId: 1 })).toBe(true);
    expect(socket.events()).toEqual([{ kind: "tab-closed", tabId: 1 }]);
  });

  it("answers ping with an empty result and runs no command", () => {
    const { factory, handled } = connected();
    factory.last.command("p1", { op: "ping" });
    expect(factory.last.reply("p1")).toMatchObject({ ok: true, result: {} });
    expect(handled).toEqual([]);
  });
});

describe("commands", () => {
  it("returns the handler's result under the command's id", async () => {
    const { factory, handled } = connected();
    factory.last.command("c1", { op: "tabs" });
    await vi.waitFor(() => expect(factory.last.reply("c1")).toBeDefined());
    expect(handled).toEqual([{ op: "tabs" }]);
    expect(factory.last.reply("c1")).toMatchObject({ ok: true, result: { ran: "tabs" } });
  });

  it("returns the handler's refusal as the error", async () => {
    const { factory } = connected({
      handle: async () => {
        throw new Error("no_such_tab");
      },
    });
    factory.last.command("c2", { op: "cdp", tabId: 9, method: "Runtime.evaluate" });
    await vi.waitFor(() => expect(factory.last.reply("c2")).toBeDefined());
    expect(factory.last.reply("c2")).toMatchObject({ ok: false, error: "no_such_tab" });
  });

  it.each([
    ["a cdp command without a method", { op: "cdp", tabId: 3 }, "bad_command"],
    ["an open-tab without a url", { op: "open-tab", activate: true }, "bad_command"],
    ["a cookie write", { op: "set-cookies", cookies: [] }, "unknown_op"],
    ["a cache wipe", { op: "clear-data", storages: ["cookies"] }, "unknown_op"],
    ["an op nobody knows", { op: "format-disk" }, "unknown_op"],
  ])("refuses %s without running it", async (_name, command, error) => {
    const { factory, handled } = connected();
    factory.last.command("x", command);
    expect(factory.last.reply("x")).toMatchObject({ ok: false, error });
    expect(handled).toEqual([]);
  });

  it("ignores frames that are not commands", () => {
    const { factory, handled } = connected();
    const before = factory.last.sent.length;
    factory.last.deliver("not json");
    factory.last.deliver({ type: "desktop-browser-event", event: { kind: "tab-closed" } });
    factory.last.deliver({ type: "desktop-browser-command", command: { op: "tabs" } });
    expect(factory.last.sent.length).toBe(before);
    expect(handled).toEqual([]);
  });

  it("does not send a late answer on the socket that replaced the one it came on", async () => {
    let finish: (value: unknown) => void = () => {};
    const { factory } = connected({
      handle: () => new Promise((resolve) => (finish = resolve)),
    });
    const first = factory.last;
    first.command("slow", { op: "tabs" });
    first.drop(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = factory.last;
    second.accept();
    finish({ tabs: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.reply("slow")).toBeUndefined();
  });
});

describe("redialling", () => {
  it("backs off 1 s, 2 s, 4 s … 60 s, and a successful hello starts over", async () => {
    const { connection, factory } = link();
    connection.start();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const count = factory.sockets.length;
      factory.last.drop(1006);
      let waited = 0;
      while (factory.sockets.length === count) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);

    factory.last.accept();
    factory.last.command("h", { op: "hello" });
    const count = factory.sockets.length;
    factory.last.drop(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(factory.sockets.length).toBe(count + 1);
  });

  it("closes a socket that stayed silent for a minute and dials again", async () => {
    const { factory } = connected();
    const first = factory.last;
    await vi.advanceTimersByTimeAsync(59_000);
    first.command("p", { op: "ping" });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(first.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(first.closedWith).toEqual({ code: 4008, reason: "ping_timeout" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(factory.sockets.length).toBe(2);
  });
});

describe("the server's close codes", () => {
  it("4001 replaced: waits for the user, then reconnects on their word", async () => {
    const { connection, factory, states, holds } = connected();
    factory.last.drop(4001, "replaced");
    expect(states.at(-1)).toMatchObject({ status: "replaced", closeCode: 4001 });
    expect(holds.at(-1)).toEqual({ reason: "replaced" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    connection.kick();
    expect(factory.sockets.length).toBe(1);

    connection.reconnect();
    expect(factory.sockets.length).toBe(2);
    factory.last.accept();
    factory.last.command("h", { op: "hello" });
    expect(holds.at(-1)).toBeNull();
  });

  it("a replacement remembered from before a restart keeps the link from dialling", () => {
    const { connection, factory, states } = link({ hold: { reason: "replaced" } });
    connection.start();
    expect(factory.sockets).toEqual([]);
    expect(states.at(-1)?.status).toBe("replaced");
  });

  it("4003 revoked: never dials again", async () => {
    const { connection, factory, states } = connected();
    factory.last.drop(4003, "revoked");
    expect(states.at(-1)?.status).toBe("revoked");
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    connection.kick();
    connection.reconnect();
    expect(factory.sockets.length).toBe(1);
  });

  it("4005 protocol mismatch: waits for an update instead of redialling", async () => {
    const { factory, states } = connected();
    factory.last.drop(4005, "protocol_mismatch");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(factory.sockets.length).toBe(1);
    expect(states.at(-1)?.status).toBe("protocol_mismatch");
  });

  it("a server that selects no subprotocol is closed as a mismatch, unanswered", () => {
    const { connection, factory, states } = link();
    connection.start();
    factory.last.accept("");
    expect(factory.last.closedWith?.code).toBe(4005);
    expect(states.at(-1)?.status).toBe("protocol_mismatch");
  });

  it("4009 disabled: asks again after an hour, not before", async () => {
    const { connection, factory, states } = connected();
    factory.last.drop(4009, "disabled");
    expect(states.at(-1)?.status).toBe("disabled");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    connection.kick();
    expect(factory.sockets.length).toBe(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(factory.sockets.length).toBe(2);
  });
});

describe("several servers", () => {
  it("a close on one server's link leaves the other connected and answering", async () => {
    const a = connected({ origin: "https://a.example.com" });
    const b = connected({ origin: "http://localhost:7369" });
    a.factory.last.drop(4003, "revoked");

    b.factory.last.command("c", { op: "tabs" });
    await vi.waitFor(() => expect(b.factory.last.reply("c")).toBeDefined());
    expect(b.connection.connected).toBe(true);
    expect(b.handled).toEqual([{ op: "tabs" }]);
    expect(a.handled).toEqual([]);
  });
});
