/**
 * Terminal tests: the pure pieces (restore rendering, mode tracking, size ownership, output
 * coalescing) plus one end-to-end pass over the HTTP control plane with a real pty.
 *
 * The restore tests are where the value is — they encode the promise that a reattaching
 * client can rebuild the exact screen, which is what a browser refresh depends on.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import xterm from "@xterm/headless";
import { createTestApp, loginAdmin, apiClient } from "./helpers.js";
import { TerminalManager, MAX_TERMINALS_PER_USER } from "../src/terminal/manager.js";
import { expandHomePath } from "../src/terminal/session.js";
import { repairSpawnHelpers } from "../src/terminal/spawn-helper.js";
import { TerminalInputModeTracker } from "../src/terminal/input-mode.js";
import { TerminalOutputCoalescer } from "../src/terminal/output-coalescer.js";
import { applyTerminalSize, releaseTerminalSize } from "../src/terminal/size-ownership.js";
import { captureLines, renderRestoreAnsi } from "../src/terminal/snapshot.js";
import { resolveKeys } from "../src/terminal/routes.js";
import {
  TerminalStreamOpcode,
  decodeTerminalFrame,
  encodeTerminalFrame,
  parseResizePayload,
} from "../src/terminal/frames.js";

const { Terminal } = xterm;

/** Real ptys only on POSIX — see terminal-stream.test.ts for the Windows CI rationale. */
const describePty = describe.skipIf(process.platform === "win32");

/** A headless terminal fed with `input`, standing in for one whose pty produced it. */
function terminalWith(input: string, cols = 40, rows = 6) {
  const terminal = new Terminal({ cols, rows, scrollback: 100, allowProposedApi: true });
  terminal.write(input);
  return terminal;
}

/** Replays an ANSI stream into a fresh terminal — i.e. does what an attaching client does. */
async function replay(ansi: string, cols = 40, rows = 6): Promise<string[]> {
  const terminal = new Terminal({ cols, rows, scrollback: 100, allowProposedApi: true });
  // xterm parses writes asynchronously; read only once the parser has drained.
  await new Promise<void>((resolve) => terminal.write(ansi, resolve));
  return captureLines(terminal).lines;
}

function flush(terminal: xterm.Terminal): Promise<void> {
  return new Promise((resolve) => terminal.write("", resolve));
}

describe("restore rendering", () => {
  it("replays into an identical screen", async () => {
    const source = terminalWith("first line\r\nsecond line\r\n$ ");
    await flush(source);

    const restored = await replay(renderRestoreAnsi(source));

    expect(restored).toEqual(captureLines(source).lines);
    expect(restored[0]).toBe("first line");
    expect(restored[2]).toBe("$ ");
  });

  it("keeps colours and attributes", async () => {
    const source = terminalWith("\x1b[1;32mgreen bold\x1b[0m plain \x1b[41mred bg\x1b[0m");
    await flush(source);

    const ansi = renderRestoreAnsi(source);

    // Colours survive as SGR runs, not as plain text.
    expect(ansi).toMatch(/\x1b\[0;1;38;5;\d+m/);
    expect(ansi).toMatch(/48;5;\d+m/);
    expect((await replay(ansi))[0]).toBe("green bold plain red bg");
  });

  it("restores the cursor position, not just the text", async () => {
    // Three lines of output, then the cursor parked mid-line on row 2.
    const source = terminalWith("aaa\r\nbbb\r\nccc");
    source.write("\x1b[2;2H");
    await flush(source);

    const target = new Terminal({ cols: 40, rows: 6, allowProposedApi: true });
    target.write(renderRestoreAnsi(source));
    await flush(target);

    expect(target.buffer.active.cursorY).toBe(source.buffer.active.cursorY);
    expect(target.buffer.active.cursorX).toBe(source.buffer.active.cursorX);
  });

  it("carries scrollback so the reattached client can scroll back", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\r\n");
    const source = terminalWith(lines);
    await flush(source);

    const restored = await replay(renderRestoreAnsi(source, { scrollbackLines: 50 }));

    expect(restored).toContain("line-0");
    expect(restored.at(-1)).toBe("line-19");
  });

  it("caps scrollback when asked to", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\r\n");
    const source = terminalWith(lines);
    await flush(source);

    const restored = await replay(renderRestoreAnsi(source, { scrollbackLines: 3 }));

    expect(restored).not.toContain("line-0");
    expect(restored.at(-1)).toBe("line-29");
  });

  it("re-enters the alternate buffer for a full-screen program", async () => {
    const source = terminalWith("shell scrollback\r\n\x1b[?1049h\x1b[Hfull screen app");
    await flush(source);

    const ansi = renderRestoreAnsi(source);

    expect(ansi).toContain("\x1b[?1049h");
    expect((await replay(ansi))[0]).toBe("full screen app");
    // The alternate buffer has no scrollback of its own; the shell's is not mixed in.
    expect(await replay(ansi)).not.toContain("shell scrollback");
  });

  it("does not stack two screens when a client reattaches twice", async () => {
    const source = terminalWith("only once\r\n$ ");
    await flush(source);

    const ansi = renderRestoreAnsi(source);
    const twice = (await replay(ansi + ansi)).filter((line) => line === "only once");

    expect(twice).toHaveLength(1);
  });
});

describe("input mode tracker", () => {
  it("replays modes the program turned on", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("\x1b[?2004h\x1b[?1h");

    const preamble = tracker.preamble();

    expect(preamble).toContain("2004");
    expect(preamble).toContain("1;"); // application cursor keys, alongside bracketed paste
    expect(preamble.endsWith("h")).toBe(true);
  });

  it("replays modes the program turned off", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("\x1b[?25l"); // hidden cursor

    expect(tracker.preamble()).toBe("\x1b[?25l");
  });

  it("emits nothing when everything is at its default", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("plain output\r\n\x1b[1;32mcoloured\x1b[0m");

    expect(tracker.preamble()).toBe("");
  });

  it("handles a sequence split across two pty chunks", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("output\x1b[?20");
    tracker.feed("04h");

    expect(tracker.isEnabled(2004)).toBe(true);
  });

  it("tracks the last transition when a mode flips repeatedly", () => {
    const tracker = new TerminalInputModeTracker();
    tracker.feed("\x1b[?1049h\x1b[?1049l\x1b[?1000h\x1b[?1000l");

    expect(tracker.preamble()).toBe("");
  });
});

describe("size ownership", () => {
  const initial = { ownerId: null, cols: 80, rows: 24 };

  it("gives ownership to a claim", () => {
    const decision = applyTerminalSize(initial, {
      connectionId: "a",
      cols: 100,
      rows: 30,
      intent: "claim",
    });

    expect(decision.apply).toBe(true);
    expect(decision.state.ownerId).toBe("a");
  });

  it("transfers ownership on a claim even when the size is unchanged", () => {
    const owned = { ownerId: "a", cols: 80, rows: 24 };

    const decision = applyTerminalSize(owned, {
      connectionId: "b",
      cols: 80,
      rows: 24,
      intent: "claim",
    });

    expect(decision.state.ownerId).toBe("b");
    expect(decision.apply).toBe(false); // nothing to resize, but the owner moved
  });

  it("ignores an update from a connection that does not own the size", () => {
    const owned = { ownerId: "a", cols: 80, rows: 24 };

    const decision = applyTerminalSize(owned, {
      connectionId: "background-tab",
      cols: 40,
      rows: 10,
      intent: "update",
    });

    expect(decision.apply).toBe(false);
    expect(decision.state).toEqual(owned);
  });

  it("releases ownership only for the owning connection", () => {
    const owned = { ownerId: "a", cols: 80, rows: 24 };

    expect(releaseTerminalSize(owned, "b").ownerId).toBe("a");
    expect(releaseTerminalSize(owned, "a").ownerId).toBe(null);
  });
});

describe("output coalescer", () => {
  afterEach(() => vi.useRealTimers());

  it("flushes the first chunk immediately", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const coalescer = new TerminalOutputCoalescer((data) => flushed.push(data), 5);

    coalescer.push("a");

    expect(flushed).toEqual(["a"]); // no timer advance: a keystroke echo pays nothing
  });

  it("merges a burst into one flush", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const coalescer = new TerminalOutputCoalescer((data) => flushed.push(data), 5);

    coalescer.push("a");
    coalescer.push("b");
    coalescer.push("c");
    vi.advanceTimersByTime(5);

    expect(flushed).toEqual(["a", "bc"]);
  });

  it("flushes pending output on demand so ordering is preserved", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const coalescer = new TerminalOutputCoalescer((data) => flushed.push(data), 5);

    coalescer.push("a");
    coalescer.push("b");
    coalescer.flush();

    expect(flushed).toEqual(["a", "b"]);
  });
});

describe("frame codec", () => {
  it("round-trips an output frame", () => {
    const frame = decodeTerminalFrame(
      encodeTerminalFrame({ opcode: TerminalStreamOpcode.Output, payload: "hi" }),
    );

    expect(frame?.opcode).toBe(TerminalStreamOpcode.Output);
    expect(new TextDecoder().decode(frame?.payload)).toBe("hi");
  });

  it("rejects malformed frames instead of throwing", () => {
    expect(decodeTerminalFrame(new Uint8Array([0x01]))).toBeNull();
    expect(decodeTerminalFrame(new Uint8Array([0x7f, 0x00, 0x41]))).toBeNull();
  });

  it("rejects a resize payload that is not a usable size", () => {
    const bad = decodeTerminalFrame(
      encodeTerminalFrame({ opcode: TerminalStreamOpcode.Resize, payload: '{"cols":0,"rows":24}' }),
    );

    expect(parseResizePayload(bad!)).toBeNull();
  });
});

describe("key tokens", () => {
  it("maps named keys and control chords", () => {
    expect(resolveKeys("Enter", false)).toBe("\r");
    expect(resolveKeys("C-c", false)).toBe("\x03");
    expect(resolveKeys("Up", false)).toBe("\x1b[A");
  });

  it("sends literal text as-is when asked", () => {
    expect(resolveKeys("Enter", true)).toBe("Enter");
    expect(resolveKeys("ls -la", false)).toBe("ls -la");
  });
});

describePty("terminal API", () => {
  /** Polls the capture endpoint until the shell has produced what we are waiting for. */
  async function waitForLine(
    read: () => Promise<string[]>,
    match: RegExp,
    timeoutMs = 15000,
  ): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const lines = await read();
      if (lines.some((line) => match.test(line))) return lines;
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${match}; got: ${lines.join("|")}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it("creates, drives, captures and kills a terminal", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);

      const created = await api.post("/api/terminals", { cwd: "~", cols: 80, rows: 24 });
      expect(created.status).toBe(201);
      const terminal = (await created.json()) as { id: string; cwd: string; alive: boolean };
      expect(terminal.alive).toBe(true);

      const read = async (): Promise<string[]> => {
        const res = await api.get(`/api/terminals/${terminal.id}/capture`);
        return ((await res.json()) as { lines: string[] }).lines;
      };

      await api.post(`/api/terminals/${terminal.id}/keys`, {
        keys: "echo penguin-terminal-ok",
        literal: true,
      });
      await api.post(`/api/terminals/${terminal.id}/keys`, { keys: "Enter" });
      const lines = await waitForLine(read, /^penguin-terminal-ok$/);
      expect(lines.some((line) => line === "penguin-terminal-ok")).toBe(true);

      const listed = await api.get("/api/terminals");
      expect(((await listed.json()) as { terminals: unknown[] }).terminals).toHaveLength(1);

      expect((await api.delete(`/api/terminals/${terminal.id}`)).status).toBe(204);
    } finally {
      await t.cleanup();
    }
  });

  it("does not expose one user's terminal to another", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const adminApi = apiClient(t.app, admin.cookie);
      const created = await adminApi.post("/api/terminals", { cwd: "~" });
      const terminal = (await created.json()) as { id: string };

      const { provisionUser } = await import("./helpers.js");
      const other = await provisionUser(t.app, "someoneelse");
      const otherApi = apiClient(t.app, other.cookie);

      // 404, not 403: a terminal id belonging to someone else must not be confirmable.
      expect((await otherApi.get(`/api/terminals/${terminal.id}`)).status).toBe(404);
      expect(
        ((await (await otherApi.get("/api/terminals")).json()) as { terminals: unknown[] })
          .terminals,
      ).toHaveLength(0);
    } finally {
      await t.cleanup();
    }
  });

  it("rejects a working directory that does not exist", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).post("/api/terminals", {
        cwd: "/definitely/not/a/directory",
      });

      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });

  it("rejects a relative working directory instead of resolving it against the server", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);

      // "." exists relative to the server process cwd — which is exactly why it must not
      // be accepted: the caller has no idea where the server was started from.
      for (const cwd of [".", "relative/dir", "./tmp"]) {
        const res = await api.post("/api/terminals", { cwd });
        expect(res.status, `cwd=${cwd}`).toBe(400);
      }
    } finally {
      await t.cleanup();
    }
  });

  it("rejects a working directory that is a file, not a directory", async () => {
    const t = await createTestApp();
    try {
      const file = path.join(t.root, "a-file.txt");
      await fs.writeFile(file, "not a dir");
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).post("/api/terminals", { cwd: file });

      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });
});

// POSIX file modes only: Windows has no exec bit (chmod there toggles the read-only
// flag), so a 0644 helper and a 0755 one are indistinguishable to fs.stat. The repair
// itself never runs off darwin, so nothing is left unguarded by skipping here.
describe.skipIf(process.platform === "win32")("spawn-helper repair", () => {
  // node-pty's npm tarball ships its darwin prebuild's spawn-helper as 0644 (no exec
  // bit), and darwin's posix_spawnp then refuses it — the macOS "terminal opens blank"
  // bug.
  async function helperTree(relative: string[], mode: number): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pty-"));
    const file = path.join(root, ...relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "#!/bin/sh\n", { mode });
    await fs.chmod(file, mode); // writeFile honours umask; pin the mode exactly
    return root;
  }

  it("adds the exec bit to a prebuilt helper that lacks it", async () => {
    const root = await helperTree(["prebuilds", "darwin-arm64", "spawn-helper"], 0o644);
    const helper = path.join(root, "prebuilds", "darwin-arm64", "spawn-helper");

    expect(repairSpawnHelpers(root, "arm64")).toEqual([helper]);
    expect(fsSync.statSync(helper).mode & 0o111).not.toBe(0);
  });

  it("leaves an already-executable helper alone", async () => {
    const root = await helperTree(["build", "Release", "spawn-helper"], 0o755);

    expect(repairSpawnHelpers(root, "arm64")).toEqual([]);
  });

  it("is a no-op when node-pty shipped no helper (every non-darwin install)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pty-"));

    expect(repairSpawnHelpers(root, "x64")).toEqual([]);
  });
});

describe("home path expansion", () => {
  it("expands ~ and ~/ but leaves other paths alone", () => {
    expect(expandHomePath("~")).toBe(os.homedir());
    expect(expandHomePath("~/sub/dir")).toBe(path.join(os.homedir(), "sub/dir"));
    expect(expandHomePath("/absolute/path")).toBe("/absolute/path");
    // `~user` expansion is deliberately not supported; it must pass through (and then be
    // rejected as non-absolute) rather than being misread as the caller's home.
    expect(expandHomePath("~otheruser/dir")).toBe("~otheruser/dir");
  });
});

describe("capture ranges", () => {
  it("supports negative indices counting from the end", async () => {
    const source = terminalWith("one\r\ntwo\r\nthree\r\nfour", 40, 4);
    await flush(source);

    expect(captureLines(source, { start: -2 }).lines).toEqual(["three", "four"]);
    expect(captureLines(source, { start: -3, end: -2 }).lines).toEqual(["two", "three"]);
  });

  it("clamps out-of-range indices instead of failing", async () => {
    const source = terminalWith("one\r\ntwo", 40, 2);
    await flush(source);

    expect(captureLines(source, { start: -100 }).lines[0]).toBe("one");
    expect(captureLines(source, { start: 0, end: 100 }).totalLines).toBe(2);
    // An inverted range is empty, not an error.
    expect(captureLines(source, { start: 1, end: 0 }).lines).toEqual([]);
  });
});

describePty("terminal manager lifecycle", () => {
  /**
   * Direct manager (no HTTP) with a short grace so reap timing is testable. The registry is
   * the real one's stand-in: these tests exercise manager policy, not resource hand-off.
   */
  function shortGraceManager(graceMs = 80): TerminalManager {
    const registry = new Map<string, unknown>();
    return new TerminalManager(
      {
        register: (id, resource, dispose) => {
          registry.set(id, resource);
          // Mirrors HotResources: unregister removes AND disposes (identity-checked).
          return () => {
            if (registry.get(id) !== resource) return;
            registry.delete(id);
            dispose?.();
          };
        },
        claim: <T>(id: string) => registry.get(id) as T | undefined,
      },
      { graceMs },
    );
  }

  async function waitUntil(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("waitUntil timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("keeps an exited session readable for the grace period, then reaps it", async () => {
    const manager = shortGraceManager(80);
    try {
      const session = await manager.create({
        cwd: os.tmpdir(),
        ownerUserId: "u1",
        shell: "/bin/sh",
      });
      session.write("exit 3\n");
      await waitUntil(() => !session.alive);

      // Still there right after exiting: the final screen and exit info are readable.
      expect(manager.get(session.id)).toBeDefined();
      const info = session.info();
      expect(info.alive).toBe(false);
      expect(info.exit?.exitCode).toBe(3);

      // ...and gone once the grace period has passed.
      await waitUntil(() => manager.get(session.id) === undefined, 5000);
    } finally {
      manager.disposeAll();
    }
  }, 20_000);

  it("caps live terminals per user, not exited ones, and not other users", async () => {
    const manager = shortGraceManager(60_000); // long grace: exited sessions stay listed
    try {
      const request = (owner: string) => ({
        cwd: os.tmpdir(),
        ownerUserId: owner,
        shell: "/bin/sh",
      });
      const sessions = await Promise.all(
        Array.from({ length: MAX_TERMINALS_PER_USER }, () => manager.create(request("u1"))),
      );

      await expect(manager.create(request("u1"))).rejects.toMatchObject({ status: 429 });
      // Another user's budget is their own.
      const other = await manager.create(request("u2"));
      expect(other.alive).toBe(true);

      // A session that exited frees its slot even while still listable in the grace window.
      const first = sessions[0]!;
      first.write("exit\n");
      await waitUntil(() => !first.alive);
      expect(manager.get(first.id)).toBeDefined();
      const replacement = await manager.create(request("u1"));
      expect(replacement.alive).toBe(true);
    } finally {
      manager.disposeAll();
    }
  }, 30_000);

  it("auto-increments default names per user; explicit names pass through", async () => {
    const manager = shortGraceManager(60_000);
    try {
      const request = (owner: string, name?: string) => ({
        cwd: os.tmpdir(),
        ownerUserId: owner,
        shell: "/bin/sh",
        ...(name !== undefined ? { name } : {}),
      });
      const base = path.basename(os.tmpdir());

      const a = await manager.create(request("u1"));
      const b = await manager.create(request("u1"));
      const c = await manager.create(request("u1"));
      expect(a.info().name).toBe(base);
      expect(b.info().name).toBe(`${base} 2`);
      expect(c.info().name).toBe(`${base} 3`);
      expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
      // Another user's numbering is their own, and explicit names are never rewritten.
      const other = await manager.create(request("u2"));
      expect(other.info().name).toBe(base);
      expect(other.seq).toBe(1);
      expect((await manager.create(request("u1", "custom"))).info().name).toBe("custom");

      // Seqs are STABLE: a terminal keeps its number for life; ending one frees its
      // number for the next create but never renumbers the survivors.
      b.write("exit\n");
      await waitUntil(() => !b.alive);
      const d = await manager.create(request("u1"));
      expect(d.seq).toBe(2);
      expect(a.seq).toBe(1);
      expect(c.seq).toBe(3);
    } finally {
      manager.disposeAll();
    }
  }, 20_000);

  it("disposeAll kills the underlying shell processes", async () => {
    const manager = shortGraceManager();
    const session = await manager.create({
      cwd: os.tmpdir(),
      ownerUserId: "u1",
      shell: "/bin/sh",
    });
    const pid = session.info().pid;
    manager.disposeAll();

    // Dead means "no longer running": either the pid is gone entirely, or it lingers only
    // as a zombie (state Z) until reaped — kill(pid, 0) alone cannot tell those apart.
    const isDead = (): boolean => {
      try {
        const stat = fsSync.readFileSync(`/proc/${pid}/stat`, "utf8");
        return / [ZX] /.test(stat.slice(stat.lastIndexOf(")")));
      } catch {
        return true; // /proc entry gone (or non-Linux): the process no longer exists
      }
    };
    await waitUntil(isDead, 10_000);
    expect(manager.get(session.id)).toBeUndefined();
  }, 20_000);

  it("closing a viewer must not kill the shell (sessions are connection-independent)", async () => {
    const manager = shortGraceManager();
    try {
      const session = await manager.create({
        cwd: os.tmpdir(),
        ownerUserId: "u1",
        shell: "/bin/sh",
      });
      // Simulates every client going away: only size ownership is released.
      session.releaseSize("some-connection");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(session.alive).toBe(true);
    } finally {
      manager.disposeAll();
    }
  }, 20_000);
});
