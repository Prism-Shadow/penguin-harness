/**
 * A terminal tab outlives a reload that cannot see its machine yet.
 *
 * Pruning is the one thing the terminal list DESTROYS with: it drops terminal tabs out of
 * every conversation's stored arrangement, and storage does not give them back. The list
 * itself is assembled from several sources — this server, plus each machine the Project
 * reaches (lib/terminal-machines.ts) — and on a fresh page neither the machine set nor a
 * forward to it exists yet, so an early refresh sees this server alone. Pruning on that
 * short answer deletes the tabs of terminals that are alive on a machine, which is
 * exactly what a restart used to do: the shell was still there, its tab was not, and the
 * next open spawned a second shell beside it.
 *
 * Node-only suite: localStorage is stubbed and fetch is a per-source stub, both installed
 * before the modules are imported (dock-state.test.ts convention).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let dock: typeof import("../src/features/dock/dock-state");
let list: typeof import("../src/features/terminal/terminal-list");
let machines: typeof import("../src/lib/terminal-machines");

const REMOTE = "AtZ2EEKC5jxZipMN";
/** Terminal ids by where they live. */
const LOCAL_TERMINAL = "t-local";
const REMOTE_TERMINAL = "t-remote";

/** Per-source answers this round: source key → the terminals it lists, or null to fail. */
let answers = new Map<string, { id: string; alive: boolean }[] | null>();

/** The source a request URL names: "" for this server, the machine id for a proxied call. */
function sourceOf(url: string): string {
  return /^\/server\/([^/]+)\//.exec(url)?.[1] ?? "";
}

beforeAll(async () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (input: string) => {
      const listed = answers.get(sourceOf(String(input)));
      if (listed === undefined || listed === null) {
        // Unreachable machine: the same shape the app sees when no forward is up.
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ terminals: listed.map((t) => ({ ...t })) }),
      });
    },
  });
  dock = await import("../src/features/dock/dock-state");
  list = await import("../src/features/terminal/terminal-list");
  machines = await import("../src/lib/terminal-machines");
});

let scopeSeq = 0;

beforeEach(() => {
  machines.forgetTerminalMachines();
  answers = new Map();
  dock.setDockScope(`session-${++scopeSeq}`);
});

/** The state a reload starts from: a conversation holding a tab for a machine's shell. */
function tabForRemoteTerminal(): void {
  dock.addTerminalTab(REMOTE_TERMINAL);
  expect(dock.terminalTabIds()).toContain(REMOTE_TERMINAL);
}

describe("refreshTerminals: pruning waits for a complete picture", () => {
  it("keeps a machine's terminal tab while the machine set is still unknown", async () => {
    tabForRemoteTerminal();
    // The fresh-page state: this server answers, and it has no terminals of its own; the
    // machines have not been published yet, so they are not even asked.
    answers.set("", []);
    await list.refreshTerminals();
    expect(dock.terminalTabIds()).toContain(REMOTE_TERMINAL);
  });

  it("keeps it when the machine is known but not answering yet", async () => {
    tabForRemoteTerminal();
    machines.setTerminalMachines([REMOTE]);
    answers.set("", []);
    answers.set(REMOTE, null); // no forward up yet
    await list.refreshTerminals();
    expect(dock.terminalTabIds()).toContain(REMOTE_TERMINAL);
  });

  it("keeps it once the machine answers with it — the shell was there all along", async () => {
    tabForRemoteTerminal();
    machines.setTerminalMachines([REMOTE]);
    answers.set("", []);
    answers.set(REMOTE, [{ id: REMOTE_TERMINAL, alive: true }]);
    await list.refreshTerminals();
    expect(dock.terminalTabIds()).toContain(REMOTE_TERMINAL);
    // And the list knows where to address it from now on.
    expect(machines.machineForTerminal(REMOTE_TERMINAL)).toBe(REMOTE);
  });

  it("drops a tab only on a complete answer that does not list its terminal", async () => {
    tabForRemoteTerminal();
    dock.addTerminalTab(LOCAL_TERMINAL);
    machines.setTerminalMachines([REMOTE]);
    answers.set("", [{ id: LOCAL_TERMINAL, alive: true }]);
    answers.set(REMOTE, []); // reached, and the shell really is gone
    await list.refreshTerminals();
    expect(dock.terminalTabIds()).not.toContain(REMOTE_TERMINAL);
    expect(dock.terminalTabIds()).toContain(LOCAL_TERMINAL);
  });

  it("drops a dead shell's tab: listed, but no longer alive", async () => {
    tabForRemoteTerminal();
    machines.setTerminalMachines([REMOTE]);
    answers.set("", []);
    answers.set(REMOTE, [{ id: REMOTE_TERMINAL, alive: false }]);
    await list.refreshTerminals();
    expect(dock.terminalTabIds()).not.toContain(REMOTE_TERMINAL);
  });
});
