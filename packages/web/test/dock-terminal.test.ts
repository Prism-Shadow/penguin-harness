/**
 * The dock's terminals belong to the conversation that opened them (features/dock/dock-terminal.ts
 * over the terminal list and the dock store). The servers are faked at `fetch`; everything else is
 * the real code: the list, its machine routing, the dock store and its prune.
 *
 * - Given a conversation on a machine owns a live shell there, when a local conversation opens a
 *   terminal, it creates its own shell on this server under its own id and A's is not tabbed.
 * - Given a conversation's own shell has no tab here (opened on another device), when it opens a
 *   terminal, that shell is tabbed and none is created; the "+" menu lists its other untabbed
 *   shells and never another Session's or a shell no Session owns.
 * - Given a conversation on a machine, when it creates a shell, the shell is created on that
 *   machine under its id, falling back to home there when its Workspace is gone.
 * - Given a draft, neither terminal shortcut is taken and no shell is created; nor while the next
 *   conversation's docks are up before its page has said which Session it is.
 * - Given a conversation whose id self-heals, its shells are refiled on their own machines and its
 *   tabs survive the move and the next prune; another Session's shell is not touched.
 * - Given a complete list, a tab whose shell another Session owns leaves the docks, while a shell
 *   from a server that reports no owner (an older build) keeps its tab.
 * - Given a list fetched while this window creates a shell, the stale answer neither prunes the
 *   new tab nor replaces the list; the list is read again.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "./helpers/storage";
import { apiError, json, stubFetch, type FetchRequest } from "./helpers/fetch";

let dock: typeof import("../src/features/dock/dock-state");
let terminal: typeof import("../src/features/dock/dock-terminal");
let list: typeof import("../src/features/terminal/terminal-list");
let machines: typeof import("../src/lib/terminal-machines");
let commands: typeof import("../src/lib/shortcuts/dispatcher");

beforeAll(async () => {
  // Not vi.stubGlobal: the package config unstubs globals before every test, and the stores read
  // storage when they load.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  dock = await import("../src/features/dock/dock-state");
  terminal = await import("../src/features/dock/dock-terminal");
  list = await import("../src/features/terminal/terminal-list");
  machines = await import("../src/lib/terminal-machines");
  commands = await import("../src/lib/shortcuts/dispatcher");
});

/** A shell as a server holds it; `sessionId` undefined = a server that records no owner. */
interface Shell {
  id: string;
  sessionId?: string | null;
}

/** Each server's shells: null is this server, otherwise a machine id. */
let held: Map<string | null, Shell[]>;
let created: number;
/** While set, a list request waits for it — answering the shells as they were when asked. */
let listGate: Promise<void> | null;

function info(shell: Shell) {
  return {
    id: shell.id,
    seq: 1,
    name: "sh",
    cwd: "/home/user",
    alive: true,
    ...(shell.sessionId !== undefined ? { sessionId: shell.sessionId } : {}),
  };
}

async function answer(request: FetchRequest): Promise<Response> {
  const shells = held.get(request.machine) ?? [];
  if (request.path === "/api/terminals" && request.method === "GET") {
    const asked = shells.map(info);
    if (listGate !== null) await listGate;
    return json({ terminals: asked });
  }
  if (request.path === "/api/terminals" && request.method === "POST") {
    const body = request.body as { cwd: string; sessionId: string | null };
    if (body.cwd === "/gone") return apiError(400, "cwd_not_found");
    created += 1;
    const shell = { id: `created-${created}`, sessionId: body.sessionId };
    held.set(request.machine, [...shells, shell]);
    return json(info(shell), 201);
  }
  const one = /^\/api\/terminals\/([^/]+)$/.exec(request.path);
  const shell = one === null ? undefined : shells.find((s) => s.id === one[1]);
  if (shell !== undefined && request.method === "PATCH") {
    shell.sessionId = (request.body as { sessionId: string | null }).sessionId;
    return json(info(shell));
  }
  return apiError(404, "terminal_not_found");
}

let seq = 0;
/** A fresh conversation per test, on screen with its docks: scopes are the isolation boundary. */
function openConversation(machineId: string | null = null, workspace = "/work"): string {
  seq += 1;
  const sessionId = `session-${seq}`;
  dock.setDockScope(sessionId);
  terminal.setDockConversation({ sessionId, workspace, machineId });
  return sessionId;
}

const writes = (fake: { requests: FetchRequest[] }) =>
  fake.requests.filter((request) => request.method !== "GET");

beforeEach(() => {
  held = new Map();
  created = 0;
  listGate = null;
  machines.forgetTerminalMachines();
  machines.setTerminalMachines([]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // A create ends by re-reading the list without waiting for it; let that read land against
  // this test's servers rather than the next one's.
  await list.refreshTerminals();
});

describe("which shells a conversation opens", () => {
  it("a local conversation creates its own shell here and never takes a machine conversation's", async () => {
    machines.setTerminalMachines(["M"]);
    held.set("M", [{ id: "machine-shell", sessionId: "session-on-machine" }]);
    const fake = stubFetch(answer);
    const local = openConversation(null, "/work/local");

    await terminal.openTerminalInDock();

    expect(dock.terminalTabIds()).toEqual(["created-1"]);
    expect(writes(fake)).toMatchObject([
      { method: "POST", machine: null, body: { cwd: "/work/local", sessionId: local } },
    ]);
    expect(terminal.untabbedTerminals(local)).toEqual([]);
  });

  it("brings back its own untabbed shell instead of creating one, and lists only its own", async () => {
    const fake = stubFetch(answer);
    const mine = openConversation();
    held.set(null, [
      { id: "mine-older", sessionId: mine },
      { id: "mine-newer", sessionId: mine },
      { id: "someone-elses", sessionId: "another-session" },
      { id: "no-session", sessionId: null },
    ]);

    await terminal.openTerminalInDock();

    expect(dock.terminalTabIds()).toEqual(["mine-newer"]);
    expect(writes(fake)).toEqual([]);
    // The "+" menu's small rows: this conversation's shells with no tab here, nothing else.
    expect(terminal.untabbedTerminals(mine).map((t) => t.id)).toEqual(["mine-older"]);
  });

  it("a machine conversation creates its shell on its machine, falling back to home there", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = stubFetch(answer);
    const remote = openConversation("M", "/gone");

    await terminal.createShellInDock();

    expect(writes(fake)).toMatchObject([
      { method: "POST", machine: "M", body: { cwd: "/gone", sessionId: remote } },
      { method: "POST", machine: "M", body: { cwd: "~", sessionId: remote } },
    ]);
    expect(dock.terminalTabIds()).toEqual(["created-1"]);
    expect(machines.machineForTerminal("created-1")).toBe("M");
  });
});

describe("where no Session owns the docks", () => {
  it("a draft takes neither terminal shortcut and creates nothing", async () => {
    const fake = stubFetch(answer);
    seq += 1;
    dock.setDockScope(`default_project:draft-${seq}`);
    terminal.setDockConversation({ sessionId: null, workspace: "/work", machineId: null });

    expect(commands.runCommand("terminal.new")).toBe(false);
    expect(commands.runCommand("terminal.toggle")).toBe(false);
    await terminal.openTerminalInDock();

    expect(fake.requests).toEqual([]);
    expect(dock.terminalTabIds()).toEqual([]);
  });

  it("the next conversation's docks borrow nothing from the last one before its page says which it is", async () => {
    const fake = stubFetch(answer);
    openConversation();
    seq += 1;
    dock.setDockScope(`session-${seq}`); // the route moved on; the page has not published yet

    expect(terminal.dockSessionId()).toBeNull();
    expect(commands.runCommand("terminal.new")).toBe(false);
    await terminal.createShellInDock();

    expect(fake.requests).toEqual([]);
  });
});

describe("keeping tabs with their owner", () => {
  it("a self-healed conversation refiles its shells on their own machines and keeps its tabs", async () => {
    machines.setTerminalMachines(["M"]);
    const fake = stubFetch(answer);
    const before = openConversation();
    held.set("M", [{ id: "on-machine", sessionId: before }]);
    held.set(null, [
      { id: "here", sessionId: before },
      { id: "not-mine", sessionId: "another-session" },
    ]);
    await list.refreshTerminals();
    dock.addTerminalTab("on-machine");
    dock.addTerminalTab("here");
    const after = `${before}-healed`;

    await terminal.reownTerminals(before, after);
    dock.adoptDockScope(after);
    await list.refreshTerminals();

    expect(writes(fake)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "PATCH",
          machine: "M",
          path: "/api/terminals/on-machine",
          body: { sessionId: after },
        }),
        expect.objectContaining({
          method: "PATCH",
          machine: null,
          path: "/api/terminals/here",
          body: { sessionId: after },
        }),
      ]),
    );
    expect(writes(fake)).toHaveLength(2);
    expect(dock.terminalTabIds()).toEqual(["on-machine", "here"]);
  });

  it("a complete list removes another Session's tab and keeps an older server's shell", async () => {
    stubFetch(answer);
    const mine = openConversation();
    held.set(null, [
      { id: "crossed-over", sessionId: "another-session" },
      { id: "from-older-build" },
    ]);
    dock.addTerminalTab("crossed-over");
    dock.addTerminalTab("from-older-build");

    await list.refreshTerminals();

    expect(dock.terminalTabIds()).toEqual(["from-older-build"]);
    // …which no menu offers, though: its owner is unknown.
    expect(terminal.untabbedTerminals(mine)).toEqual([]);
  });

  it("a list fetched while a shell is created keeps the new tab and is read again", async () => {
    const fake = stubFetch(answer);
    openConversation();
    let release = () => {};
    listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refreshing = list.refreshTerminals(); // asked before the shell exists

    await terminal.createShellInDock();
    listGate = null;
    release();
    await refreshing;

    expect(dock.terminalTabIds()).toEqual(["created-1"]);
    expect(list.liveTerminals().map((t) => t.id)).toEqual(["created-1"]);
    expect(fake.requests.filter((request) => request.method === "GET")).toHaveLength(2);
  });
});
