/**
 * The user's live terminals (features/terminal/terminal-list.ts): one list over this server and
 * every machine of the Project, each shell asked of and killed on the machine that holds it, and
 * whether the list on hand heard from every source (what the terminal panel waits for before it
 * takes a shell's absence as its end).
 *
 * - Given machines published and every source answering, the list is every live shell of every
 *   source (a shell whose pty exited is not), concurrent refreshes share one request per source,
 *   and a kill of a machine's shell is sent to that machine.
 * - Given a machine that does not answer this round, its shells are not listed and the list says
 *   it is short; once it answers they are back and the list is whole. Given this server not
 *   answering, the last list stands.
 * - Given this server answering 404 (a runtime older than the terminal API), the API is reported
 *   missing, until it answers again.
 * - Given this server answering 401, it is asked once whether the sign-in still holds, and the
 *   list stands.
 * - Given a kill, the shell leaves the list at once; a refresh while its pty still winds down does
 *   not bring it back, and the list reconciles on its own once the pty has exited. A kill that
 *   never takes hides the shell for a bounded time only.
 * - Given a shell the user just created, it is listed at once, and only once; a title change
 *   reaches a listed shell and nothing else.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "./helpers/storage";
import { terminalWorld } from "./helpers/terminal-world";

/** The list and the machine map, fresh and from one module graph. */
async function modules() {
  vi.resetModules();
  stubLocalStorage();
  return {
    list: await import("../src/features/terminal/terminal-list"),
    machines: await import("../src/lib/terminal-machines"),
  };
}

const listed = (list: { liveTerminals(): { id: string }[] }) =>
  list.liveTerminals().map((t) => t.id);

afterEach(() => {
  vi.useRealTimers();
});

describe("the terminal list", () => {
  it("lists every live shell of every source, asks each once per refresh, and kills a machine's shell there", async () => {
    const world = terminalWorld({
      here: [{ id: "here-1" }, { id: "here-exited", alive: false }],
      machines: { M1: [{ id: "m1-1" }] },
    });
    const { list, machines } = await modules();
    machines.setTerminalMachines(["M1"]);

    await Promise.all([list.refreshTerminals(), list.refreshTerminals()]);
    expect(listed(list)).toEqual(["here-1", "m1-1"]);
    expect(world.requests(null, "GET")).toHaveLength(1);
    expect(world.requests("M1", "GET")).toHaveLength(1);

    await list.killTerminal("m1-1");
    expect(world.requests("M1", "DELETE").map((r) => r.path)).toEqual(["/api/terminals/m1-1"]);
    expect(world.requests(null, "DELETE")).toEqual([]);
    expect(listed(list)).toEqual(["here-1"]);
  });

  it("leaves out a machine that does not answer and says the list is short, and keeps the list when this server does not answer", async () => {
    const world = terminalWorld({ here: [{ id: "here-1" }], machines: { M1: [{ id: "m1-1" }] } });
    const { list, machines } = await modules();
    machines.setTerminalMachines(["M1"]);

    world.unreachable("M1");
    await list.refreshTerminals();
    expect(listed(list)).toEqual(["here-1"]);
    expect(list.terminalListComplete()).toBe(false);

    world.unreachable("M1", false);
    await list.refreshTerminals();
    expect(listed(list)).toEqual(["here-1", "m1-1"]);
    expect(list.terminalListComplete()).toBe(true);

    world.unreachable(null);
    await list.refreshTerminals();
    expect(listed(list)).toEqual(["here-1", "m1-1"]);
  });

  it("reports the terminal API missing on a 404 from this server, until it answers again", async () => {
    const world = terminalWorld({ here: [{ id: "here-1" }] });
    const { list } = await modules();
    world.answerWith(null, 404);
    await list.refreshTerminals();
    expect(list.terminalApiSupported()).toBe(false);

    world.answerWith(null, null);
    await list.refreshTerminals();
    expect(list.terminalApiSupported()).toBe(true);
    expect(listed(list)).toEqual(["here-1"]);
  });

  it("asks once whether the sign-in holds on a 401, and keeps the list", async () => {
    const world = terminalWorld({ here: [{ id: "here-1" }] });
    const { list } = await modules();
    await list.refreshTerminals();

    world.answerWith(null, 401);
    await list.refreshTerminals();
    await vi.waitFor(() =>
      expect(world.fetch.requests.filter((r) => r.path === "/api/me")).toHaveLength(1),
    );
    expect(listed(list)).toEqual(["here-1"]);
  });

  it("drops a killed shell at once, never resurrects it while it winds down, and reconciles once it exits", async () => {
    vi.useFakeTimers();
    const world = terminalWorld({ here: [{ id: "here-1" }, { id: "doomed" }] });
    const { list } = await modules();
    await list.refreshTerminals();

    await list.killTerminal("doomed");
    expect(listed(list)).toEqual(["here-1"]);
    // The DELETE only signals: the server still lists the shell alive a moment later.
    await list.refreshTerminals();
    expect(listed(list)).toEqual(["here-1"]);

    world.remove("doomed");
    const before = world.requests(null, "GET").length;
    await vi.advanceTimersByTimeAsync(300);
    expect(world.requests(null, "GET").length).toBeGreaterThan(before);
    expect(listed(list)).toEqual(["here-1"]);
  });

  it("shows a shell whose kill never took again once the grace window is over", async () => {
    vi.useFakeTimers();
    terminalWorld({ here: [{ id: "stubborn" }] });
    const { list } = await modules();
    await list.refreshTerminals();
    await list.killTerminal("stubborn");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(listed(list)).toEqual([]);

    await vi.advanceTimersByTimeAsync(10_000);
    await list.refreshTerminals();
    expect(listed(list)).toEqual(["stubborn"]);
  });

  it("lists a shell the user just created at once and once, and retitles only a listed shell", async () => {
    terminalWorld();
    const { list } = await modules();
    const created = { id: "new-1", name: "shell", cwd: "~", alive: true };
    list.noteTerminalCreated(created);
    list.noteTerminalCreated(created);
    expect(listed(list)).toEqual(["new-1"]);

    list.noteTerminalTitle("new-1", "vim notes.md");
    const snapshot = list.liveTerminals();
    list.noteTerminalTitle("not-listed", "top");
    expect(list.liveTerminals()).toBe(snapshot);
    expect(snapshot.map((t) => t.title)).toEqual(["vim notes.md"]);
  });
});
