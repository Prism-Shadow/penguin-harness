/**
 * The terminal socket's life on a link that keeps dropping it (terminal-connection.ts).
 *
 * These are the promises the pane depends on when the network is a phone's: a dropped
 * socket comes back on its own, a suspended tab does not get mistaken for a dead link, a
 * terminal that is genuinely gone stops the retries, and the heartbeat answers whoever
 * probes it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RETRY_DELAYS_MS,
  TerminalConnection,
  type AttachedSocket,
  type SocketHandlers,
  type TerminalConnectionStatus,
} from "../src/features/terminal/terminal-connection";
import { TerminalOpcode, decodeFrame, encodeFrame } from "../src/features/terminal/terminal-frames";

/** One fake socket: records what was sent, and lets a test play the link's part. */
class FakeSocket implements AttachedSocket {
  readonly sent: Uint8Array[] = [];
  closed = false;
  constructor(readonly handlers: SocketHandlers) {}
  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
  close(): void {
    this.closed = true;
  }
  /** The server accepted the upgrade. */
  open(): void {
    this.handlers.onOpen();
  }
  /** The server sent one frame. */
  deliver(opcode: TerminalOpcode, text = ""): void {
    this.handlers.onMessage(encodeFrame(opcode, text).buffer as ArrayBuffer);
  }
  /** The link went away. */
  drop(): void {
    this.handlers.onClose();
  }
  opcodes(): number[] {
    return this.sent.map((bytes) => bytes[0] as number);
  }
}

interface Harness {
  connection: TerminalConnection;
  sockets: FakeSocket[];
  statuses: { status: TerminalConnectionStatus; detail: string }[];
  frames: number[];
  /** Whether a retry finds the terminal still on the server. */
  setPresent(present: boolean): void;
}

function harness(options: { first?: () => Promise<string> } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const statuses: Harness["statuses"] = [];
  const frames: number[] = [];
  let present = true;
  const connection = new TerminalConnection({
    first: options.first ?? (() => Promise.resolve("t1")),
    recheck: () => Promise.resolve(present),
    open: (_id, handlers) => {
      const socket = new FakeSocket(handlers);
      sockets.push(socket);
      return socket;
    },
    onFrame: (frame) => frames.push(frame.opcode),
    onStatus: (status, detail) => statuses.push({ status, detail }),
  });
  return {
    connection,
    sockets,
    statuses,
    frames,
    setPresent: (next) => {
      present = next;
    },
  };
}

/** Lets the connection's own promises settle between timer steps. */
const settle = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => vi.useRealTimers());

describe("terminal connection", () => {
  it("reports ready once the socket opens", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();

    expect(h.statuses).toEqual([{ status: "ready", detail: "" }]);
  });

  it("reattaches after the link drops, and says so meanwhile", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();

    expect(h.statuses.at(-1)?.status).toBe("reconnecting");
    expect(h.sockets).toHaveLength(1); // the retry is a wait, not a hot loop

    await vi.advanceTimersByTimeAsync((RETRY_DELAYS_MS[0] as number) * 1.2);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]?.open();
    expect(h.statuses.at(-1)?.status).toBe("ready");
  });

  it("backs off further with each failed attempt", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();

    await vi.advanceTimersByTimeAsync((RETRY_DELAYS_MS[0] as number) * 1.2);
    h.sockets[1]?.drop(); // the second attach never opened
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] as number);
    expect(h.sockets).toHaveLength(2); // the first delay is no longer enough

    await vi.advanceTimersByTimeAsync((RETRY_DELAYS_MS[1] as number) * 1.2);
    expect(h.sockets).toHaveLength(3);
  });

  it("stops retrying when the terminal is gone", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.setPresent(false);
    h.sockets[0]?.drop();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.sockets).toHaveLength(1);
    expect(h.statuses.at(-1)).toEqual({ status: "error", detail: "terminal is gone" });
  });

  it("keeps the first attach fatal: the host's policy is not retried", async () => {
    vi.useFakeTimers();
    const h = harness({ first: () => Promise.reject(new Error("no terminal API")) });
    h.connection.start();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.sockets).toHaveLength(0);
    expect(h.statuses.at(-1)).toEqual({ status: "error", detail: "no terminal API" });
  });

  it("answers the server's probe and keeps it off the terminal", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    socket.deliver(TerminalOpcode.Ping, "1234");

    const reply = socket.sent.at(-1) as Uint8Array;
    expect(reply[0]).toBe(TerminalOpcode.Pong);
    expect(decodeFrame(reply.buffer as ArrayBuffer)?.text).toBe("1234");
    expect(h.frames).toEqual([]); // heartbeat traffic never reaches xterm
  });

  it("passes output through to the terminal", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    socket.deliver(TerminalOpcode.Output, "hello");

    expect(h.frames).toEqual([TerminalOpcode.Output]);
  });

  it("drops a socket that stopped answering, and reattaches", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    socket.deliver(TerminalOpcode.Pong, "1"); // this server speaks the heartbeat

    // Probe after probe goes unanswered; the tick that finds the silence past the limit
    // gives up on the socket instead of probing again.
    await vi.advanceTimersByTimeAsync(65_000);

    expect(socket.opcodes()).toContain(TerminalOpcode.Ping);
    expect(socket.closed).toBe(true);
    expect(h.statuses.at(-1)?.status).toBe("reconnecting");
  });

  it("never judges the silence of a server that does not answer probes", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open(); // a server from before the heartbeat: it ignores the opcode

    await vi.advanceTimersByTimeAsync(300_000);
    h.connection.wake();
    await vi.advanceTimersByTimeAsync(30_000);

    // An idle terminal on such a server is quiet for good reasons, and reattaching every
    // minute would repaint the screen from a snapshot for nothing.
    expect(socket.closed).toBe(false);
    expect(h.sockets).toHaveLength(1);
  });

  it("treats a frozen tab as a wake-up, not as a dead link", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();

    // The browser suspended this tab: one tick fires, an hour late.
    vi.setSystemTime(Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(socket.closed).toBe(false);
    expect(socket.opcodes().at(-1)).toBe(TerminalOpcode.Ping); // it asks instead of judging
  });

  it("wakes into an immediate reattach instead of sitting out the backoff", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();

    h.connection.wake();
    await settle();

    expect(h.sockets).toHaveLength(2);
  });

  it("probes a socket that only looks open when the tab comes back", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    socket.deliver(TerminalOpcode.Pong, "1"); // this server speaks the heartbeat

    h.connection.wake();
    expect(socket.opcodes().at(-1)).toBe(TerminalOpcode.Ping);

    await vi.advanceTimersByTimeAsync(6_000); // no echo came back
    expect(socket.closed).toBe(true);
    expect(h.statuses.at(-1)?.status).toBe("reconnecting");
  });

  it("keeps a socket that answers the wake-up probe", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();

    h.connection.wake();
    await vi.advanceTimersByTimeAsync(1_000);
    socket.deliver(TerminalOpcode.Pong, "1");
    await vi.advanceTimersByTimeAsync(6_000);

    expect(socket.closed).toBe(false);
  });

  it("drops input typed into a gap rather than replaying it later", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.sockets[0]?.drop();

    h.connection.send(encodeFrame(TerminalOpcode.Input, "rm -rf /\r"));
    await vi.advanceTimersByTimeAsync((RETRY_DELAYS_MS[0] as number) * 1.2);
    h.sockets[1]?.open();

    expect(h.sockets[1]?.sent).toEqual([]);
  });

  it("stops for good once the pane is gone", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.connection.start();
    await settle();
    h.sockets[0]?.open();
    h.connection.stop();

    expect(h.sockets[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});
