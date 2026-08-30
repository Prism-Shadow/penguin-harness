/**
 * A terminal on a machine is addressed there (lib/terminal-machines.ts).
 *
 * A terminal is a pty on ONE machine's kernel: created there, its bytes come from there,
 * and killing it means killing it there. The rule is the Session rule, over the path — and
 * its narrowness is the same deliberate one: `/api/terminals/<id>` names a terminal, the
 * bare collection does not, because "which terminals have you got" is a question only the
 * server being asked can answer about itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetTerminalMachines,
  machineForTerminal,
  rememberTerminalMachine,
  setTerminalMachines,
  terminalMachinesPublished,
  terminalIdInPath,
  terminalSources,
  terminalUrl,
} from "../src/lib/terminal-machines";

const REMOTE = "AtZ2EEKC5jxZipMN";

afterEach(() => {
  setTerminalMachines([]);
  // Last: it clears the published flag too, so every test starts from "not asked yet".
  forgetTerminalMachines();
});

describe("where a terminal lives", () => {
  it("remembers a machine, and forgets it when it moves back here", () => {
    rememberTerminalMachine("t1", REMOTE);
    expect(machineForTerminal("t1")).toBe(REMOTE);
    rememberTerminalMachine("t1", null);
    expect(machineForTerminal("t1")).toBeNull();
  });

  it("treats an unknown terminal as this server's", () => {
    // Every terminal that existed before terminals could live anywhere else.
    expect(machineForTerminal("never-seen")).toBeNull();
  });
});

describe("the routing rule over the path", () => {
  it("reads the id out of a terminal-scoped path, and only those", () => {
    expect(terminalIdInPath("/api/terminals/t1")).toBe("t1");
    expect(terminalIdInPath("/api/terminals/t1/stream")).toBe("t1");
    expect(terminalIdInPath("/api/terminals")).toBeNull();
    expect(terminalIdInPath("/api/sessions/s1")).toBeNull();
  });

  it("decodes an escaped id rather than addressing a literal one", () => {
    expect(terminalIdInPath("/api/terminals/a%2Fb/stream")).toBe("a/b");
  });

  it("sends a terminal's calls to its machine, the stream included", () => {
    rememberTerminalMachine("t1", REMOTE);
    expect(terminalUrl("/api/terminals/t1")).toBe(`/server/${REMOTE}/api/terminals/t1`);
    expect(terminalUrl("/api/terminals/t1/stream")).toBe(
      `/server/${REMOTE}/api/terminals/t1/stream`,
    );
  });

  it("leaves this server's terminals, and the collection, alone", () => {
    rememberTerminalMachine("t1", REMOTE);
    expect(terminalUrl("/api/terminals/local")).toBe("/api/terminals/local");
    // The collection is never routed by the rule: it is asked of each server in turn.
    expect(terminalUrl("/api/terminals")).toBe("/api/terminals");
  });

  it("takes an explicit machine for the one call with no id yet", () => {
    // Creating a terminal names its machine before the terminal exists.
    expect(terminalUrl("/api/terminals", REMOTE)).toBe(`/server/${REMOTE}/api/terminals`);
    expect(terminalUrl("/api/terminals", null)).toBe("/api/terminals");
  });

  it("lets an explicit machine override what is remembered", () => {
    rememberTerminalMachine("t1", REMOTE);
    expect(terminalUrl("/api/terminals/t1", null)).toBe("/api/terminals/t1");
  });
});

describe("which servers the list asks", () => {
  it("is this one, then every machine", () => {
    setTerminalMachines([REMOTE, "other"]);
    expect(terminalSources()).toEqual([null, REMOTE, "other"]);
  });

  it("is this one alone when no machine is reachable", () => {
    expect(terminalSources()).toEqual([null]);
  });
});

describe("whether the machine set is known yet", () => {
  it("is false until SessionsProvider publishes, and an empty publication still counts", () => {
    // The distinction the guard rests on: before the publication an empty source list means
    // "not asked yet", and a caller that would discard something on a terminal's absence
    // must not act on it. A Project with no machines publishes [] and is then known.
    expect(terminalMachinesPublished()).toBe(false);
    setTerminalMachines([]);
    expect(terminalMachinesPublished()).toBe(true);
    setTerminalMachines([REMOTE]);
    expect(terminalMachinesPublished()).toBe(true);
  });

  it("goes back to unknown on sign-out, so the next page waits again", () => {
    setTerminalMachines([REMOTE]);
    forgetTerminalMachines();
    expect(terminalMachinesPublished()).toBe(false);
    // And the sources shrink back to this server alone, rather than addressing a machine
    // the next account may not have.
    expect(terminalSources()).toEqual([null]);
  });
});
