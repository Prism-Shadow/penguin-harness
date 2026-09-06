/**
 * The surface on its own, against a fake terminal manager: what it declares matches what it
 * binds; the argv it builds; and the activity heuristic — output means running, silence
 * past the window means idle, exit means idle — reported once per flip, never repeated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Terminals } from "@prismshadow/penguin-server/plugin";
import type { SurfaceSessionRef, SurfaceState } from "@prismshadow/penguin-core/plugin";
import plugin, {
  ACTIVITY_WINDOW_MS,
  ClaudeCodeSurface,
  INHERITED_SESSION_MARKERS,
  claudeArgv,
  claudeBinary,
} from "../src/index.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  penguin: {
    modules: Array<{
      name: string;
      requires: Record<string, { iface: string; from?: string }>;
      contributes: Record<string, Array<{ id: string; kind: string; renderer: unknown }>>;
    }>;
  };
};

/** A terminal that records what it was created with and lets the test drive its events. */
function fakeTerminals() {
  const created: Array<{ request: Record<string, unknown>; terminal: FakeTerminal }> = [];
  class FakeTerminal {
    readonly id = `t${created.length + 1}`;
    alive = true;
    private readonly outputs = new Set<(data: string) => void>();
    private readonly exits = new Set<() => void>();
    onOutput(l: (data: string) => void) {
      this.outputs.add(l);
      return () => this.outputs.delete(l);
    }
    onExit(l: () => void) {
      this.exits.add(l);
      return () => this.exits.delete(l);
    }
    emit(data: string) {
      for (const l of this.outputs) l(data);
    }
    exit() {
      this.alive = false;
      for (const l of this.exits) l();
    }
    kill() {
      this.exit();
    }
  }
  const byId = new Map<string, FakeTerminal>();
  const terminals = {
    async create(request: Record<string, unknown>) {
      const terminal = new FakeTerminal();
      created.push({ request, terminal });
      byId.set(terminal.id, terminal);
      return terminal;
    },
    get: (id: string) => byId.get(id),
  } as unknown as Terminals;
  return { terminals, created };
}

const ref: SurfaceSessionRef = {
  sessionId: "s1",
  projectId: "p",
  agentId: "a",
  workspace: "/work",
  ownerUserId: "admin",
};

describe("the manifest and the plugin agree", () => {
  it("binds the one surface the manifest declares, and requires only Terminals", () => {
    const [module] = manifest.penguin.modules;
    expect(module!.name).toBe("ClaudeCode");
    expect(Object.keys(module!.requires)).toEqual(["terminals"]);
    expect(module!.requires.terminals!.iface).toBe("@prismshadow/penguin-server#Terminals");
    const [contribution] = module!.contributes["SessionSurfacesModule.surfaces"]!;
    expect(contribution).toMatchObject({
      id: "claude-code.surface",
      kind: "claude-code",
      renderer: { builtin: "TerminalSurface" },
    });
    expect(Object.keys(plugin.modules!)).toEqual(["ClaudeCode"]);
  });
});

describe("the program", () => {
  it("is claude from PATH unless PENGUIN_CLAUDE_BIN names another", () => {
    expect(claudeBinary({})).toBe("claude");
    expect(claudeBinary({ PENGUIN_CLAUDE_BIN: " /opt/claude " })).toBe("/opt/claude");
    expect(claudeArgv(undefined, {})).toEqual(["claude"]);
    expect(claudeArgv("  ", {})).toEqual(["claude"]);
    expect(claudeArgv("fix the tests", { PENGUIN_CLAUDE_BIN: "c" })).toEqual([
      "c",
      "fix the tests",
    ]);
  });
});

describe("the surface", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the program in the Workspace as the user's own pty, and reads output as activity", async () => {
    const { terminals, created } = fakeTerminals();
    const surface = new ClaudeCodeSurface(terminals, { PENGUIN_CLAUDE_BIN: "fake" });
    const states: SurfaceState[] = [];
    const view = await surface.open(ref, { prompt: "hello", cols: 100, rows: 30 }, (s) =>
      states.push(s),
    );
    expect(created[0]!.request).toMatchObject({
      cwd: "/work",
      ownerUserId: "admin",
      command: ["fake", "hello"],
      cols: 100,
      rows: 30,
    });
    expect(view).toEqual({ alive: true, view: { terminalId: "t1" } });
    // A harness started from inside a Claude Code session must not hand its own session
    // markers to the child: it would read them as "I am nested" and stop saving a transcript.
    expect(created[0]!.request.unsetEnv).toEqual(INHERITED_SESSION_MARKERS);
    expect(INHERITED_SESSION_MARKERS).toContain("CLAUDECODE");
    expect(INHERITED_SESSION_MARKERS).toContain("CLAUDE_CODE_SESSION_ID");
    // Configuration a deployment sets on purpose is inherited, not scrubbed.
    expect(INHERITED_SESSION_MARKERS).not.toContain("CLAUDE_CODE_USE_BEDROCK");
    expect(surface.status("s1")).toBe("idle");

    const terminal = created[0]!.terminal;
    terminal.emit("...");
    terminal.emit("...");
    expect(surface.status("s1")).toBe("running");
    expect(states).toEqual(["running"]);
    vi.advanceTimersByTime(ACTIVITY_WINDOW_MS - 1);
    expect(surface.status("s1")).toBe("running");
    vi.advanceTimersByTime(2);
    expect(surface.status("s1")).toBe("idle");
    expect(states).toEqual(["running", "idle"]);

    terminal.emit(">");
    expect(states).toEqual(["running", "idle", "running"]);
    terminal.exit();
    expect(surface.status("s1")).toBe("idle");
    expect(surface.view("s1")).toEqual({ alive: false, view: { terminalId: "t1" } });
    expect(states).toEqual(["running", "idle", "running", "idle"]);
  });

  it("opening again reuses a live pty and replaces a dead one", async () => {
    const { terminals, created } = fakeTerminals();
    const surface = new ClaudeCodeSurface(terminals, {});
    await surface.open(ref, {}, () => {});
    await surface.open(ref, { prompt: "again" }, () => {});
    expect(created).toHaveLength(1);
    created[0]!.terminal.exit();
    const reopened = await surface.open(ref, { prompt: "again" }, () => {});
    expect(created).toHaveLength(2);
    expect(created[1]!.request).toMatchObject({ command: ["claude", "again"] });
    expect(reopened.view).toEqual({ terminalId: "t2" });
  });

  it("closing kills the pty, and a parked map claims live terminals back", async () => {
    const { terminals, created } = fakeTerminals();
    const surface = new ClaudeCodeSurface(terminals, {});
    await surface.open(ref, {}, () => {});
    await surface.open({ ...ref, sessionId: "s2" }, {}, () => {});
    expect(surface.park()).toEqual({ sessions: { s1: "t1", s2: "t2" } });

    surface.close("s1");
    expect(created[0]!.terminal.alive).toBe(false);
    expect(surface.view("s1")).toBeNull();

    // The next App: s2's pty is still alive and comes back; s1's is gone and does not.
    const next = new ClaudeCodeSurface(terminals, {});
    next.adopt({ sessions: { s1: "t1", s2: "t2" } });
    expect(next.view("s1")).toBeNull();
    expect(next.view("s2")).toEqual({ alive: true, view: { terminalId: "t2" } });
    const states: SurfaceState[] = [];
    await next.open({ ...ref, sessionId: "s2" }, {}, (s) => states.push(s));
    created[1]!.terminal.emit("x");
    expect(states).toEqual(["running"]);
  });
});
