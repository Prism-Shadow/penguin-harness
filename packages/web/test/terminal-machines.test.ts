/**
 * Which machine a terminal lives on (lib/terminal-machines.ts): the same rule Sessions use,
 * over `/api/terminals/<id>`, plus the sources the list asks — this server, then each machine.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetTerminalMachines,
  machineForTerminal,
  rememberTerminalMachine,
  setTerminalMachines,
  terminalIdInPath,
  terminalSources,
  terminalUrl,
} from "../src/lib/terminal-machines";

afterEach(() => forgetTerminalMachines());

describe("the terminal id in a path", () => {
  it("reads /api/terminals/<id> and beneath, not the bare collection", () => {
    expect(terminalIdInPath("/api/terminals/t1")).toBe("t1");
    expect(terminalIdInPath("/api/terminals/t1/stream?cols=80")).toBe("t1");
    expect(terminalIdInPath("/api/terminals")).toBeNull();
    expect(terminalIdInPath("/api/sessions/s1")).toBeNull();
  });
});

describe("addressing a terminal", () => {
  it("goes to the machine that holds it, and stays here for one nobody recorded", () => {
    rememberTerminalMachine("t1", "M1");
    expect(machineForTerminal("t1")).toBe("M1");
    expect(terminalUrl("/api/terminals/t1")).toBe("/server/M1/api/terminals/t1");
    expect(terminalUrl("/api/terminals/t2")).toBe("/api/terminals/t2");
  });

  it("an explicit server overrides the rule — creating a terminal has no id yet to route by", () => {
    expect(terminalUrl("/api/terminals", "M2")).toBe("/server/M2/api/terminals");
    expect(terminalUrl("/api/terminals", null)).toBe("/api/terminals");
  });
});

describe("the machine set", () => {
  it("asks this server first, then each published machine", () => {
    expect(terminalSources()).toEqual([null]);
    setTerminalMachines(["M1", "M2"]);
    expect(terminalSources()).toEqual([null, "M1", "M2"]);
  });

  it("is forgotten whole on sign-out", () => {
    setTerminalMachines(["M1"]);
    rememberTerminalMachine("t1", "M1");
    forgetTerminalMachines();
    expect(terminalSources()).toEqual([null]);
    expect(machineForTerminal("t1")).toBeNull();
  });
});
