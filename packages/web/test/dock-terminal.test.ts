/**
 * The terminal panel's conversation side (features/dock/dock-terminal.ts over the terminal list
 * and the dock store): which shells a conversation lists, which one it shows, and the shells it
 * starts. The servers are faked at `fetch`; everything else is the real code.
 *
 * - Given a conversation on a machine owns a live shell there, when a local conversation opens
 *   its terminal panel with no shell, the list is read first and one shell is started on this
 *   server under its own id; the machine conversation's shell is not listed.
 * - Given a conversation with live shells of its own (one opened on another device among them),
 *   the panel lists exactly those — never another Session's, a shell no Session owns, or one
 *   whose server reports no owner — shows the newest, and starts nothing.
 * - Given a conversation on a machine, its shells start on that machine under its id, falling back
 *   to home there when its Workspace is gone.
 * - Given the panel asked to start its first shell twice at once, one shell starts.
 * - Given `terminal.new`, another shell starts and becomes the shown one, the panel on screen.
 * - Given the shown shell ends, the panel shows the newest that is left.
 * - Given a draft, neither terminal shortcut is taken, nothing starts and the panel is not
 *   offered; nor while the next conversation's docks are up before its page says which it is.
 * - Given a conversation whose id self-heals, its shells are refiled on their own machines and
 *   its panel goes on listing them; another Session's shell is not touched.
 * - Given a list fetched while this window starts a shell, the stale answer is not applied and
 *   the list is read again.
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

describe("which shells a conversation's panel lists and starts", () => {
  it("a local conversation reads the list, then starts its own shell here, never a machine one's", async () => {
    machines.setTerminalMachines(["M"]);
    held.set("M", [{ id: "machine-shell", sessionId: "session-on-machine" }]);
    const fake = stubFetch(answer);
    const local = openConversation(null, "/work/local");

    terminal.openTerminalPanel();
    await terminal.ensureShell();

    expect(writes(fake)).toMatchObject([
      { method: "POST", machine: null, body: { cwd: "/work/local", sessionId: local } },
    ]);
    expect(fake.requests[0]).toMatchObject({ method: "GET" }); // the list came first
    expect(terminal.ownTerminals().map((t) => t.id)).toEqual(["created-1"]);
    expect(terminal.shownTerminalId()).toBe("created-1");
    expect(dock.panelDock(terminal.TERMINAL_PANEL)).toBe("bottom");
  });

  it("lists exactly the conversation's own shells, shows the newest, and starts nothing", async () => {
    const fake = stubFetch(answer);
    const mine = openConversation();
    held.set(null, [
      { id: "mine-older", sessionId: mine },
      { id: "someone-elses", sessionId: "another-session" },
      { id: "no-session", sessionId: null },
      { id: "older-build" },
      { id: "mine-from-another-device", sessionId: mine },
    ]);

    terminal.openTerminalPanel();
    await terminal.ensureShell();

    expect(writes(fake)).toEqual([]);
    expect(terminal.ownTerminals().map((t) => t.id)).toEqual([
      "mine-older",
      "mine-from-another-device",
    ]);
    expect(terminal.shownTerminalId()).toBe("mine-from-another-device");
  });

  it("a machine conversation starts its shell on its machine, falling back to home there", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = stubFetch(answer);
    const remote = openConversation("M", "/gone");

    await terminal.createShell();

    expect(writes(fake)).toMatchObject([
      { method: "POST", machine: "M", body: { cwd: "/gone", sessionId: remote } },
      { method: "POST", machine: "M", body: { cwd: "~", sessionId: remote } },
    ]);
    expect(machines.machineForTerminal("created-1")).toBe("M");
    expect(terminal.shownTerminalId()).toBe("created-1");
  });

  it("asked twice at once to start the first shell, starts one", async () => {
    const fake = stubFetch(answer);
    openConversation();
    terminal.openTerminalPanel();

    await Promise.all([terminal.ensureShell(), terminal.ensureShell()]);

    expect(writes(fake)).toHaveLength(1);
  });

  it("terminal.new starts another shell and shows it, the panel on screen", async () => {
    const fake = stubFetch(answer);
    const mine = openConversation();
    held.set(null, [{ id: "first", sessionId: mine }]);
    await list.refreshTerminals();

    expect(commands.runCommand("terminal.new")).toBe(true);
    await vi.waitFor(() => expect(terminal.shownTerminalId()).toBe("created-1"));

    expect(writes(fake)).toHaveLength(1);
    expect(terminal.ownTerminals().map((t) => t.id)).toEqual(["first", "created-1"]);
    expect(dock.isTabShown(terminal.TERMINAL_PANEL)).toBe(true);
  });

  it("shows the newest shell left when the shown one ends", async () => {
    stubFetch(answer);
    const mine = openConversation();
    held.set(null, [
      { id: "older", sessionId: mine },
      { id: "newer", sessionId: mine },
    ]);
    await list.refreshTerminals();
    dock.setShownShell("older");
    expect(terminal.shownTerminalId()).toBe("older");

    held.set(null, [{ id: "newer", sessionId: mine }]); // `exit` in the shown shell
    await list.refreshTerminals();

    expect(terminal.shownTerminalId()).toBe("newer");
  });
});

describe("where no Session owns the docks", () => {
  it("a draft takes neither terminal shortcut, starts nothing and offers no terminal panel", async () => {
    const fake = stubFetch(answer);
    seq += 1;
    dock.setDockScope(`default_project:draft-${seq}`);
    terminal.setDockConversation({ sessionId: null, workspace: "/work", machineId: null });

    expect(commands.runCommand("terminal.new")).toBe(false);
    expect(commands.runCommand("terminal.toggle")).toBe(false);
    await terminal.ensureShell();

    expect(fake.requests).toEqual([]);
    expect(terminal.terminalPanelOffered()).toBe(false);
    expect(dock.panelDock(terminal.TERMINAL_PANEL)).toBeNull();
  });

  it("the next conversation's docks borrow nothing from the last one before its page says which it is", async () => {
    const fake = stubFetch(answer);
    openConversation();
    expect(terminal.terminalPanelOffered()).toBe(true);
    seq += 1;
    dock.setDockScope(`session-${seq}`); // the route moved on; the page has not published yet

    expect(terminal.dockSessionId()).toBeNull();
    expect(terminal.terminalPanelOffered()).toBe(false);
    expect(commands.runCommand("terminal.new")).toBe(false);
    await terminal.createShell();

    expect(fake.requests).toEqual([]);
  });
});

describe("keeping shells with their owner", () => {
  it("a self-healed conversation refiles its shells on their own machines and goes on listing them", async () => {
    machines.setTerminalMachines(["M"]);
    const fake = stubFetch(answer);
    const before = openConversation();
    held.set("M", [{ id: "on-machine", sessionId: before }]);
    held.set(null, [
      { id: "here", sessionId: before },
      { id: "not-mine", sessionId: "another-session" },
    ]);
    const after = `${before}-healed`;

    await terminal.reownTerminals(before, after);
    dock.adoptDockScope(before, after);
    terminal.setDockConversation({ sessionId: after, workspace: "/work", machineId: null });
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
    // The panel lists the conversation's shells on its own machine: this server's here.
    expect(terminal.ownTerminals().map((t) => t.id)).toEqual(["here"]);
  });

  it("a list fetched while a shell starts is not applied, and is read again", async () => {
    const fake = stubFetch(answer);
    openConversation();
    let release = () => {};
    listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refreshing = list.refreshTerminals(); // asked before the shell exists

    await terminal.createShell();
    listGate = null;
    release();
    await refreshing;

    expect(terminal.ownTerminals().map((t) => t.id)).toEqual(["created-1"]);
    expect(fake.requests.filter((request) => request.method === "GET")).toHaveLength(2);
  });
});
