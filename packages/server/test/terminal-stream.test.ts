/**
 * Terminal WebSocket data-plane tests, over a real listening server (the stream is an HTTP
 * Upgrade, which app.request() can never exercise).
 *
 * Scenarios: handshake auth (cookie, origin, ownership), the Restore-first attach
 * contract, reattach fidelity, multi-client behaviour, size ownership, exit notification,
 * and hostile-input tolerance. These are the promises the web dock and /terminal page are
 * built on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import { createTestApp, loginAdmin, provisionUser, apiClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import {
  TerminalStreamOpcode,
  decodeTerminalFrame,
  encodeTerminalFrame,
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

interface StreamClient {
  ws: WebSocket;
  frames: Array<{ opcode: number; text: string }>;
  /** Concatenation of every Output payload so far. */
  outputText(): string;
  /** Payload of the first Restore frame (the attach snapshot). */
  restoreText(): string;
  sendInput(text: string): void;
  sendResize(cols: number, rows: number, intent: "claim" | "update"): void;
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
  options: { cookie?: string; cols?: number; rows?: number; origin?: string } = {},
): Promise<StreamClient> {
  const headers: Record<string, string> = { cookie: options.cookie ?? adminCookie };
  if (options.origin !== undefined) headers.origin = options.origin;
  const ws = new WebSocket(streamUrl(id, options.cols ?? 80, options.rows ?? 24), { headers });
  const frames: StreamClient["frames"] = [];
  // Every server-sent frame must decode; checked from waitFor (throwing inside the ws
  // 'message' listener would surface as an uncaught exception, not a test failure).
  let undecodable = 0;

  ws.on("message", (raw: Buffer) => {
    const frame = decodeTerminalFrame(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!frame) {
      undecodable += 1;
      return;
    }
    frames.push({ opcode: frame.opcode, text: new TextDecoder().decode(frame.payload) });
  });

  const client: StreamClient = {
    ws,
    frames,
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
    waitFor: async (predicate, what, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (undecodable > 0) throw new Error(`Received ${undecodable} undecodable frame(s).`);
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${what}. Frames: ${JSON.stringify(frames)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (undecodable > 0) throw new Error(`Received ${undecodable} undecodable frame(s).`);
    },
    close: () =>
      new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once("close", () => resolve());
        ws.close();
      }),
  };

  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
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

describePty("terminal stream backpressure", () => {
  it("resyncs a lagging viewer with a fresh Restore instead of disconnecting it", async () => {
    const terminal = await createTerminal();
    try {
      const client = await attach(terminal.id);
      await client.waitFor(() => client.restoreText().length > 0, "attach restore");

      // Stop reading: the TCP window and then the server's userland queue fill while
      // the shell floods ~7 MB — far past the high watermark.
      const socket = (client.ws as unknown as { _socket: { pause(): void; resume(): void } })
        ._socket;
      socket.pause();
      // Flood until the server itself reports this viewer as lagging. A fixed burst is a
      // coin flip: a paused reader still lets the kernel absorb megabytes into its socket
      // buffers (autotuned), so the server's own send queue — the thing the watermark
      // measures — may never cross 1 MiB however much the shell wrote. This suite failed
      // that way roughly one run in three, locally and on CI.
      const isLagging = (): boolean => serverLogs.some((l) => l.includes("pausing for resync"));
      for (let round = 1; round <= 8 && !isLagging(); round += 1) {
        client.sendInput(`yes 0123456789abcdef | head -n 400000; echo BURST-DONE-${round}\r`);
        await waitForCapture(terminal.id, `BURST-DONE-${round}`, 60_000);
      }
      expect(isLagging(), "server never marked the paused viewer as lagging").toBe(true);

      // The burst has fully landed server-side, and the lagging viewer is still attached.
      expect(client.ws.readyState).toBe(WebSocket.OPEN);

      // Catching up delivers one resync Restore carrying the final screen, and the
      // stream is live again afterwards.
      socket.resume();
      const restores = (): number =>
        client.frames.filter((f) => f.opcode === TerminalStreamOpcode.Restore).length;
      await client.waitFor(() => restores() >= 2, "resync Restore frame", 60_000);
      const resync = client.frames.filter((f) => f.opcode === TerminalStreamOpcode.Restore)[1]!;
      expect(resync.text).toContain("BURST-DONE-");
      await runAndWait(client, "echo LIVE-$((40+2))", "LIVE-42");
      await client.close();
    } finally {
      await api.delete(`/api/terminals/${terminal.id}`);
    }
    // Megabytes through a pty, a paused socket and a drain: minutes of budget on a loaded
    // runner, where the default would report a timeout rather than a real defect.
  }, 120_000);
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
