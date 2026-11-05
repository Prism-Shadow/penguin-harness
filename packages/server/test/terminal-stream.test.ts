/**
 * Terminal WebSocket data-plane tests, over a real listening server (the stream is an HTTP
 * Upgrade, which app.request() can never exercise).
 *
 * Scenarios: handshake auth (cookie, origin, ownership), the Restore-first attach
 * contract, reattach fidelity, multi-client behaviour, size ownership, exit notification,
 * and hostile-input tolerance. These are the promises the web dock and /terminal page are
 * built on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import type { Socket as NetSocket } from "node:net";
import { WebSocket } from "ws";
import { createTestApp, loginAdmin, provisionUser, apiClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import {
  TerminalStreamOpcode,
  decodeTerminalFrame,
  encodeTerminalFrame,
  framePayloadText,
} from "../src/terminal/frames.js";

const TEST_TIMEOUT = 20_000;

/**
 * Real ptys only on POSIX: Windows CI runs headless, where ConPTY's console-list agent
 * dies with "AttachConsole failed" and node-pty leaks unhandled IPC rejections. The pure
 * suites (frames, restore, ownership, …) in terminal.test.ts still run everywhere.
 */
const IS_WINDOWS = process.platform === "win32";
const describePty = describe.skipIf(IS_WINDOWS);

let t: TestApp;
let port: number;
let server: ReturnType<typeof serve>;
let adminCookie: string;
let api: ReturnType<typeof apiClient>;
/** Everything terminal/ws.ts logged for this suite (see the log hook in beforeAll). */
const serverLogs: string[] = [];

beforeAll(async () => {
  if (IS_WINDOWS) return;
  t = await createTestApp();
  const admin = await loginAdmin(t.app);
  adminCookie = admin.cookie;
  api = apiClient(t.app, adminCookie);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: t.deps.hmr,
    authService: t.deps.authService,
    // Kept, not discarded: the backpressure test's precondition (the server deciding a
    // viewer is too far behind) is only observable through this line.
    log: (line) => serverLogs.push(line),
  });
});

/**
 * Every test's shells are killed before the next one starts. The suite shares one app, and
 * the terminal registry caps a user at MAX_TERMINALS_PER_USER LIVE shells: fourteen tests
 * each opening a /bin/sh that nothing closes only fit under that cap when enough earlier
 * shells happened to exit first — which is why the suite passed on one runner and answered
 * 429 on a slower one. A kill is a signal, not an exit, so this waits for the registry to
 * report none alive rather than trusting the DELETE.
 */
afterEach(async () => {
  if (IS_WINDOWS) return;
  const listed = (await (await api.get("/api/terminals")).json()) as {
    terminals: TerminalInfoJson[];
  };
  for (const terminal of listed.terminals) await api.delete(`/api/terminals/${terminal.id}`);
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = (await (await api.get("/api/terminals")).json()) as {
      terminals: TerminalInfoJson[];
    };
    if (!now.terminals.some((terminal) => terminal.alive)) return;
    if (Date.now() > deadline) throw new Error("terminals from the previous test are still alive");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

afterAll(async () => {
  if (IS_WINDOWS) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.cleanup();
});

interface TerminalInfoJson {
  id: string;
  cols: number;
  rows: number;
  alive: boolean;
}

async function createTerminal(cols = 80, rows = 24): Promise<TerminalInfoJson> {
  // Pinned to /bin/sh: the default (the developer's login shell) may repaint prompts or
  // flip terminal modes on its own, which would make mode/restore assertions racy.
  const res = await api.post("/api/terminals", { cwd: "~", cols, rows, shell: "/bin/sh" });
  expect(res.status).toBe(201);
  return (await res.json()) as TerminalInfoJson;
}

async function terminalInfo(id: string): Promise<TerminalInfoJson> {
  const res = await api.get(`/api/terminals/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as TerminalInfoJson;
}

/**
 * One server→client data frame as it left the wire, before ws inflates it: the compression
 * test reads the RSV1 bit (permessage-deflate) and the frame's real length from here.
 */
interface WireFrame {
  rsv1: boolean;
  opcode: number;
  length: number;
  payload: Uint8Array;
}

interface StreamClient {
  ws: WebSocket;
  frames: Array<{ opcode: number; text: string }>;
  /** Raw first-fragment frames seen on the socket; populated only for deflate clients. */
  wire: WireFrame[];
  /** Concatenation of every Output payload so far. */
  outputText(): string;
  /** Payload of the first Restore frame (the attach snapshot). */
  restoreText(): string;
  sendInput(text: string): void;
  sendResize(cols: number, rows: number, intent: "claim" | "update"): void;
  sendPing(payload: string): void;
  waitFor(predicate: () => boolean, what: string, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

function streamUrl(id: string, cols?: number, rows?: number): string {
  const size = cols !== undefined && rows !== undefined ? `?cols=${cols}&rows=${rows}` : "";
  return `ws://127.0.0.1:${port}/api/terminals/${id}/stream${size}`;
}

/** Opens a stream and resolves once connected; every received frame must decode. */
function attach(
  id: string,
  options: {
    cookie?: string;
    cols?: number;
    rows?: number;
    origin?: string;
    /** Negotiate permessage-deflate (a browser does) and record raw frames on the wire. */
    deflate?: boolean;
  } = {},
): Promise<StreamClient> {
  const headers: Record<string, string> = { cookie: options.cookie ?? adminCookie };
  if (options.origin !== undefined) headers.origin = options.origin;
  const ws = new WebSocket(streamUrl(id, options.cols ?? 80, options.rows ?? 24), {
    headers,
    ...(options.deflate === true ? { perMessageDeflate: {} } : {}),
  });
  const frames: StreamClient["frames"] = [];
  const wire: WireFrame[] = [];
  // Every server-sent frame must decode; checked from waitFor (throwing inside the ws
  // 'message' listener would surface as an uncaught exception, not a test failure).
  let undecodable = 0;
  let wireError: string | null = null;

  ws.on("message", (raw: Buffer) => {
    const frame = decodeTerminalFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!frame) {
      undecodable += 1;
      return;
    }
    frames.push({ opcode: frame.opcode, text: new TextDecoder().decode(frame.payload) });
  });

  // The wire tap for the deflate client: walks the raw server→client stream and records
  // each message's first fragment — the one that carries the compression bit. Server
  // frames are never masked, so the walk is header + length + payload, nothing else.
  const watchWire = (): void => {
    const sock = (ws as unknown as { _socket?: NetSocket })._socket;
    if (sock === undefined) {
      wireError = "the deflate client has no underlying socket to watch";
      return;
    }
    let pending = Buffer.alloc(0);
    sock.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (pending.length < 2) break;
        const b0 = pending[0] as number;
        const b1 = pending[1] as number;
        if ((b1 & 0x80) !== 0) {
          wireError = "server frames must arrive unmasked";
          return;
        }
        let header = 2;
        let length = b1 & 0x7f;
        if (length === 126) {
          if (pending.length < 4) break;
          length = pending.readUInt16BE(2);
          header = 4;
        } else if (length === 127) {
          if (pending.length < 10) break;
          const huge = pending.readBigUInt64BE(2);
          if (huge > 0xffff_ffffn) {
            wireError = "a frame too large to parse";
            return;
          }
          length = Number(huge);
          header = 10;
        }
        if (pending.length < header + length) break;
        if ((b0 & 0x0f) !== 0) {
          wire.push({
            rsv1: (b0 & 0x40) !== 0,
            opcode: b0 & 0x0f,
            length,
            payload: new Uint8Array(pending.subarray(header, header + length)),
          });
        }
        pending = pending.subarray(header + length);
      }
    });
  };

  const client: StreamClient = {
    ws,
    frames,
    wire,
    outputText: () =>
      frames
        .filter((f) => f.opcode === TerminalStreamOpcode.Output)
        .map((f) => f.text)
        .join(""),
    restoreText: () => frames.find((f) => f.opcode === TerminalStreamOpcode.Restore)?.text ?? "",
    sendInput: (text) =>
      ws.send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Input, payload: text })),
    sendResize: (cols, rows, intent) =>
      ws.send(
        encodeTerminalFrame({
          opcode: TerminalStreamOpcode.Resize,
          payload: JSON.stringify({ cols, rows, intent }),
        }),
      ),
    sendPing: (payload) =>
      ws.send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Ping, payload })),
    waitFor: async (predicate, what, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (undecodable > 0) throw new Error(`Received ${undecodable} undecodable frame(s).`);
        if (wireError !== null) throw new Error(wireError);
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${what}. Frames: ${JSON.stringify(frames)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (undecodable > 0) throw new Error(`Received ${undecodable} undecodable frame(s).`);
      if (wireError !== null) throw new Error(wireError);
    },
    close: () =>
      new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once("close", () => resolve());
        ws.close();
      }),
  };

  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      if (options.deflate === true) watchWire();
      resolve(client);
    });
    ws.once("unexpected-response", (_req, res) =>
      reject(new Error(`handshake rejected: ${res.statusCode}`)),
    );
    ws.once("error", (err) => reject(err));
  });
}

/** Asserts the handshake is refused with the given HTTP status. */
function expectRefused(id: string, headers: Record<string, string>, status: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(streamUrl(id, 80, 24), { headers });
    ws.once("open", () => reject(new Error("handshake unexpectedly accepted")));
    ws.once("unexpected-response", (_req, res) => {
      try {
        expect(res.statusCode).toBe(status);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        ws.terminate();
      }
    });
    ws.once("error", (err) => reject(err));
  });
}

/** Runs a command on the stream and waits until its marker shows up in the output. */
async function runAndWait(client: StreamClient, command: string, marker: string): Promise<void> {
  client.sendInput(`${command}\r`);
  await client.waitFor(() => client.outputText().includes(marker), `output marker ${marker}`);
}

/** Polls the capture API until the given text is on the server-side screen. */
async function waitForCapture(id: string, marker: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await api.get(`/api/terminals/${id}/capture`);
    const { lines } = (await res.json()) as { lines: string[] };
    if (lines.some((line) => line.includes(marker))) return;
    if (Date.now() > deadline) throw new Error(`capture never showed ${marker}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describePty("terminal stream handshake", () => {
  it(
    "refuses the stream without a session cookie",
    async () => {
      const terminal = await createTerminal();
      await expectRefused(terminal.id, {}, 401);
      await expectRefused(terminal.id, { cookie: "penguin_session=not-a-real-token" }, 401);
    },
    TEST_TIMEOUT,
  );

  it(
    "refuses a cross-origin browser handshake even with a valid cookie",
    async () => {
      const terminal = await createTerminal();
      await expectRefused(
        terminal.id,
        { cookie: adminCookie, origin: "http://evil.example.com" },
        403,
      );
    },
    TEST_TIMEOUT,
  );

  // The refusal cases below use a bogus id on purpose: cookie and origin are checked
  // before the session lookup, and not creating a terminal keeps this suite's total under
  // the per-user cap the later scenarios rely on.
  it(
    "treats a malformed cookie escape as unauthenticated, not as a server error",
    async () => {
      // "%" is an invalid percent escape: decodeURIComponent throws, and in the `upgrade`
      // handler an uncaught throw would take down the whole server (unauthenticated DoS).
      await expectRefused("irrelevant", { cookie: "penguin_session=%" }, 401);
    },
    TEST_TIMEOUT,
  );

  it(
    "refuses a same-host origin on a different port — cookies are port-agnostic",
    async () => {
      await expectRefused(
        "irrelevant",
        { cookie: adminCookie, origin: `http://127.0.0.1:${port + 1}` },
        403,
      );
      // The old check blanket-allowed every loopback origin; any local dev server's page
      // could ride the session cookie into a shell.
      await expectRefused(
        "irrelevant",
        { cookie: adminCookie, origin: "http://localhost:5173" },
        403,
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "accepts the genuinely same-origin handshake",
    async () => {
      const terminal = await createTerminal();
      try {
        const client = await attach(terminal.id, { origin: `http://127.0.0.1:${port}` });
        await client.close();
      } finally {
        await api.delete(`/api/terminals/${terminal.id}`);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "answers 404 for unknown ids and for another user's terminal",
    async () => {
      const terminal = await createTerminal();
      await expectRefused("no-such-terminal", { cookie: adminCookie }, 404);
      const other = await provisionUser(t.app, "streamintruder");
      await expectRefused(terminal.id, { cookie: other.cookie }, 404);
    },
    TEST_TIMEOUT,
  );
});

/**
 * What the backpressure flood is made of: random bytes, not repeated ones.
 *
 * The stream is compressed on the wire (terminal/ws.ts), and repeated text leaves the
 * socket a hundred times smaller than it entered — a `yes`-style burst is delivered as fast
 * as a shell can produce it and never puts a viewer behind at all. base64 of /dev/urandom
 * is the cheapest output a shell can produce that compresses to nothing, so what the viewer
 * is behind on is real.
 */
const FLOOD_COMMAND = "head -c 4000000 /dev/urandom | base64";
/**
 * A screenful of that flood: base64 runs on two consecutive rows. The restore stream writes
 * the grid row by row, so this holds whichever instant the resync snapshot is taken at —
 * unlike a marker printed once per round, which megabytes of scrolling carry off the screen.
 */
const FLOOD_ROWS = /[A-Za-z0-9+/]{40}\r\n[A-Za-z0-9+/]{40}/;

/** Every Restore opens with this self-contained repaint (see snapshot.ts). */
const RESTORE_PREAMBLE = "\x1b[0m\x1b[?1049l\x1b[H\x1b[2J\x1b[3J";

describePty("terminal stream heartbeat", () => {
  it(
    "echoes a client's probe, so a client can tell a live socket from a dead one",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id);
      try {
        client.sendPing("42");
        await client.waitFor(
          () => client.frames.some((f) => f.opcode === TerminalStreamOpcode.Pong),
          "pong",
        );

        const pong = client.frames.find((f) => f.opcode === TerminalStreamOpcode.Pong);
        // Echoed untouched: the payload is the CLIENT's clock reading, and only the client
        // can make a round trip out of it.
        expect(pong?.text).toBe("42");
      } finally {
        await client.close();
        await api.delete(`/api/terminals/${terminal.id}`);
      }
    },
    TEST_TIMEOUT,
  );
});

describePty("terminal stream compression", () => {
  it(
    "leaves small frames uncompressed and large ones compressed once permessage-deflate is negotiated",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id, { deflate: true });
      try {
        await client.waitFor(() => client.restoreText().length > 0, "attach restore");

        // A keystroke-sized burst: the command's echo, its output and the next prompt
        // together are far below the threshold, and on the wire it must arrive as-is —
        // RSV1 clear, the bytes decodable as a terminal frame with no inflate anywhere.
        const SMALL_MARKER = "zz-small-uncompressed-42";
        await runAndWait(client, `echo ${SMALL_MARKER}`, SMALL_MARKER);
        await client.waitFor(
          () =>
            client.wire.some((f) => {
              if (f.rsv1) return false;
              const frame = decodeTerminalFrame(f.payload);
              return (
                frame !== null &&
                frame.opcode === TerminalStreamOpcode.Output &&
                framePayloadText(frame).includes(SMALL_MARKER)
              );
            }),
          "the small frame on the wire uncompressed",
        );

        // A large burst of barely compressible bytes stays compressed: RSV1 set, and —
        // random base64 shrinks little — still far past the threshold on the wire.
        await runAndWait(
          client,
          "head -c 4000 /dev/urandom | base64; echo big-burst-done",
          "big-burst-done",
        );
        expect(client.wire.some((f) => f.rsv1 && f.length >= 512)).toBe(true);
      } finally {
        await client.close();
        await api.delete(`/api/terminals/${terminal.id}`);
      }
    },
    TEST_TIMEOUT,
  );
});

describePty("terminal stream backpressure", () => {
  it("resyncs a lagging viewer with a fresh Restore instead of disconnecting it", async () => {
    const terminal = await createTerminal();
    const client = await attach(terminal.id);
    try {
      await client.waitFor(() => client.restoreText().length > 0, "attach restore");

      // Stop reading: the TCP window and then the server's userland queue fill while
      // the shell floods ~7 MB — far past the high watermark. Pausing the WebSocket rather
      // than the socket under it is what makes the pause hold: ws pauses that socket on
      // its own whenever its receiver backs up, and resumes it again on the receiver's
      // 'drain' unless this flag says the caller asked for the pause.
      client.ws.pause();
      // Flood until the server itself reports this viewer as lagging. A fixed burst is a
      // coin flip: a paused reader still lets the kernel absorb megabytes into its socket
      // buffers (autotuned), so the viewer's backlog — the thing the watermark measures —
      // may never cross 1 MiB however much the shell wrote. This suite failed that way
      // roughly one run in three, locally and on CI.
      //
      // Only lines logged from here on count. `serverLogs` outlives one attempt and vitest
      // retries this file on macOS, so a second attempt reading the first one's line would
      // skip the flood altogether and then sit out the resync deadline below on a terminal
      // nothing ever flooded — which is how a single flake became a hard 60s failure.
      const loggedBefore = serverLogs.length;
      const isLagging = (): boolean =>
        serverLogs.slice(loggedBefore).some((l) => l.includes("pausing for resync"));
      let lastRound = 0;
      for (let round = 1; round <= 8 && !isLagging(); round += 1) {
        lastRound = round;
        // The pty echoes a command line the instant it is typed, so a literal marker would
        // satisfy this wait before the flood behind it had produced one byte. All eight
        // rounds would then go out back-to-back and land as one undifferentiated flood: the
        // kernel's autotuned buffers absorb far more than a single round's share, and
        // whichever way the watermark lands, the assert below races a stream that is still
        // running — the flake this suite was known for. The arithmetic is the fix: the echo
        // of "BURST-$((20+1))" matches nothing the wait accepts, so a round ends only once
        // the shell has actually run it — its burst fully landed server-side.
        client.sendInput(`${FLOOD_COMMAND}; echo BURST-$((20+${round}))\r`);
        await waitForCapture(terminal.id, `BURST-${20 + round}`, 60_000);
      }
      expect(isLagging(), "server never marked the paused viewer as lagging").toBe(true);

      // The burst has fully landed server-side, and the lagging viewer is still attached.
      expect(client.ws.readyState).toBe(WebSocket.OPEN);

      // Catching up delivers a resync Restore, and the stream is live again afterwards —
      // but which frame ends the cycle depends on the link, so the settle cannot wait for
      // a particular one. On a slow link the kernel absorbs the flood as fast as the pty
      // emits it: the resync fires mid-flood, no second high-water crossing follows, and
      // the round's end marker reaches the client as live output — no marker-bearing
      // Restore ever exists. What every timing has in common is the marker arriving at
      // the client, in whichever frame carries it: the marker is the last thing the round
      // produces, so once the client holds it, nothing of the flood is left in flight.
      const burstEnd = `BURST-${20 + lastRound}`;
      client.ws.resume();
      await client.waitFor(
        () => client.frames.some((f) => f.text.includes(burstEnd)),
        "the flood's end to reach the client",
        // The flood's tail is the last thing through the backlog the paused socket
        // accumulated, and chewing through it is plain CPU — the slowest step of this
        // case on a starved runner, so the cap is deliberately generous.
        90_000,
      );

      // One race is still open at that instant: a resync whose poll had not yet fired
      // repaints within one interval (250ms) of the client catching up, and a probe
      // typed before it would land in that drop window. The repaint arrives as a Restore
      // — a data frame — so a quiet window far longer than the poll, in which nothing
      // but the heartbeat arrives, proves none was pending: the pane is quiet, and the
      // live probe below is typed to an idle shell.
      let quietSince = 0;
      let quietFrames = -1;
      const streamQuiet = (): boolean => {
        const dataFrames = client.frames.filter(
          (f) => f.opcode !== TerminalStreamOpcode.Ping,
        ).length;
        if (dataFrames !== quietFrames) {
          quietFrames = dataFrames;
          quietSince = Date.now();
        }
        return Date.now() - quietSince >= 2_000;
      };
      await client.waitFor(streamQuiet, "a quiet stream after the flood", 30_000);

      // The resync this case exists to verify: the lagging gate above means the server
      // desynced this viewer, and the only way out of that state is the poll's fresh
      // Restore — so a repaint carrying the flooded pane must have arrived. It is not
      // necessarily the marker-bearing one (the mid-flood timing above legitimately
      // skips that); the flooded pane is the promise, and it identifies the repaint.
      const resync = client.frames.find(
        (f) => f.opcode === TerminalStreamOpcode.Restore && FLOOD_ROWS.test(f.text),
      );
      expect(resync, "a resync repaint of the flooded pane").toBeDefined();
      // What a resync promises is the repaint, not a particular line of screen residue —
      // it is the same self-contained repaint an attach sends, and it carries the flooded
      // screen rather than the empty one the attach Restore captured.
      expect(resync!.text.slice(0, RESTORE_PREAMBLE.length)).toBe(RESTORE_PREAMBLE);
      await runAndWait(client, "echo LIVE-$((40+2))", "LIVE-42");
    } finally {
      // Closed here rather than after the assertions: a socket a failed assertion left open
      // holds server.close() in afterAll until the hook deadline, which buries the real
      // failure under a hook timeout.
      await client.close();
      await api.delete(`/api/terminals/${terminal.id}`);
    }
    // Megabytes through a pty, a paused socket and a drain: minutes of budget on a loaded
    // runner, where the default would report a timeout rather than a real defect.
  }, 180_000);
});

describePty("terminal stream attach", () => {
  it(
    "sends Restore first, then round-trips input to live output",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id);
      try {
        await client.waitFor(() => client.frames.length > 0, "first frame");
        expect(client.frames[0]?.opcode).toBe(TerminalStreamOpcode.Restore);
        await runAndWait(client, "echo stream-attach-ok", "stream-attach-ok");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "a reattaching client's Restore carries the previous output",
    async () => {
      const terminal = await createTerminal();
      const first = await attach(terminal.id);
      try {
        await runAndWait(first, "echo restore-me-marker", "restore-me-marker");
      } finally {
        await first.close();
      }

      const second = await attach(terminal.id);
      try {
        await second.waitFor(() => second.restoreText() !== "", "restore frame");
        expect(second.restoreText()).toContain("restore-me-marker");
        // ...and the reattached stream is live, not a screenshot.
        await runAndWait(second, "echo still-live-marker", "still-live-marker");
      } finally {
        await second.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "replays input modes a program enabled to a reattaching client",
    async () => {
      const terminal = await createTerminal();
      const first = await attach(terminal.id);
      try {
        // Wait for the shell to reach a prompt first: `sh -l` sources a profile, and under
        // load that output can land AFTER our command — resetting the very mode this test
        // then expects to survive.
        await runAndWait(first, "echo shell-ready-marker", "shell-ready-marker");
        // Hide the cursor (DECTCSM reset) — a mode a reattached view must reproduce.
        await runAndWait(first, "printf '\\033[?25l'; echo mode-set-marker", "mode-set-marker");
      } finally {
        await first.close();
      }

      const second = await attach(terminal.id);
      try {
        await second.waitFor(() => second.restoreText() !== "", "restore frame");
        expect(second.restoreText()).toContain("\x1b[?25l");
      } finally {
        await second.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "delivers output to every attached client, and either client can type",
    async () => {
      const terminal = await createTerminal();
      const a = await attach(terminal.id);
      const b = await attach(terminal.id);
      try {
        a.sendInput("echo from-client-a\r");
        await a.waitFor(() => a.outputText().includes("from-client-a"), "a sees a's output");
        await b.waitFor(() => b.outputText().includes("from-client-a"), "b sees a's output");

        b.sendInput("echo from-client-b\r");
        await a.waitFor(() => a.outputText().includes("from-client-b"), "a sees b's output");
        await b.waitFor(() => b.outputText().includes("from-client-b"), "b sees b's output");
      } finally {
        await a.close();
        await b.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describePty("terminal stream size ownership", () => {
  it(
    "the latest claim owns the pty size; updates from non-owners are ignored",
    async () => {
      const terminal = await createTerminal(80, 24);
      const a = await attach(terminal.id, { cols: 80, rows: 24 });
      const b = await attach(terminal.id, { cols: 100, rows: 30 });
      try {
        // B attached last: its claim owns the geometry.
        expect(await terminalInfo(terminal.id)).toMatchObject({ cols: 100, rows: 30 });

        // A's passive update must not squash the owner's viewport…
        a.sendResize(60, 20, "update");
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await terminalInfo(terminal.id)).toMatchObject({ cols: 100, rows: 30 });

        // …but an explicit claim (the user went back to that view) takes over.
        a.sendResize(60, 20, "claim");
        const deadline = Date.now() + 5000;
        for (;;) {
          const info = await terminalInfo(terminal.id);
          if (info.cols === 60 && info.rows === 20) break;
          if (Date.now() > deadline) throw new Error(`size never claimed: ${JSON.stringify(info)}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        await a.close();
        await b.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "a disconnecting owner releases the size for the next claimant",
    async () => {
      const terminal = await createTerminal(80, 24);
      const owner = await attach(terminal.id, { cols: 120, rows: 40 });
      expect(await terminalInfo(terminal.id)).toMatchObject({ cols: 120, rows: 40 });
      await owner.close();

      const next = await attach(terminal.id, { cols: 90, rows: 28 });
      try {
        expect(await terminalInfo(terminal.id)).toMatchObject({ cols: 90, rows: 28 });
      } finally {
        await next.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describePty("terminal stream robustness", () => {
  it(
    "survives malformed, empty and non-binary frames",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id);
      try {
        client.ws.send("plain text is not a frame");
        client.ws.send(new Uint8Array(0));
        client.ws.send(new Uint8Array([0x7f, 0x00, 0x41])); // unknown opcode
        client.ws.send(encodeTerminalFrame({ opcode: TerminalStreamOpcode.Input, payload: "" }));
        client.ws.send(
          encodeTerminalFrame({ opcode: TerminalStreamOpcode.Resize, payload: "not json" }),
        );
        client.ws.send(
          encodeTerminalFrame({
            opcode: TerminalStreamOpcode.Resize,
            payload: '{"cols":-5,"rows":1e99,"intent":"claim"}',
          }),
        );
        // Server-only opcodes echoed back by a confused client must be ignored too.
        client.ws.send(
          encodeTerminalFrame({ opcode: TerminalStreamOpcode.Exit, payload: '{"exitCode":0}' }),
        );

        await runAndWait(client, "echo still-alive-marker", "still-alive-marker");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "keeps frames decodable and the shell usable through a large output burst",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id);
      try {
        // ~200KB of 'x' in one go; every received frame is decode-checked in attach().
        await runAndWait(
          client,
          "head -c 200000 /dev/zero | tr '\\0' 'x'; echo burst-done-marker",
          "burst-done-marker",
        );
        await runAndWait(client, "echo after-burst-marker", "after-burst-marker");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "notifies attached clients when the shell exits, and the screen stays attachable",
    async () => {
      const terminal = await createTerminal();
      const client = await attach(terminal.id);
      try {
        await runAndWait(client, "echo exit-scenario-marker", "exit-scenario-marker");
        client.sendInput("exit\r");
        await client.waitFor(
          () => client.frames.some((f) => f.opcode === TerminalStreamOpcode.Exit),
          "exit frame",
        );
      } finally {
        await client.close();
      }

      // During the post-exit grace the terminal is still there: a fresh attach shows the
      // final screen and is told immediately that the shell is gone.
      const late = await attach(terminal.id);
      try {
        await late.waitFor(
          () => late.frames.some((f) => f.opcode === TerminalStreamOpcode.Exit),
          "exit frame on late attach",
        );
        expect(late.frames[0]?.opcode).toBe(TerminalStreamOpcode.Restore);
        expect(late.restoreText()).toContain("exit-scenario-marker");
      } finally {
        await late.close();
      }

      // The control plane agrees: keystrokes to an exited shell are a 409, not a hang.
      const res = await api.post(`/api/terminals/${terminal.id}/keys`, { keys: "Enter" });
      expect(res.status).toBe(409);
    },
    TEST_TIMEOUT,
  );
});
