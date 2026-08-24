/**
 * Reading an installed server's state off the probe's output. The far side only has a
 * shell, so the answer arrives as the lock file's text plus a marker line — this is the
 * parsing that turns it back into a state, and the cases that must NOT read as "running".
 */
import { describe, expect, it } from "vitest";
import { SERVER_ALIVE_MARK, readServerStateCommand } from "../src/machines/commands.js";
import { parseServerState } from "../src/machines/server-state.js";

const lock = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ pid: 4242, port: 7364, startedAt: "2026-08-24T12:00:00.000Z", ...over });

describe("readServerStateCommand", () => {
  it("reads the lock under the data root the install creates, and marks a live pid", () => {
    const command = readServerStateCommand();
    expect(command).toContain("$HOME/.penguin/data/server.lock");
    expect(command).toContain("kill -0");
    expect(command).toContain(SERVER_ALIVE_MARK);
  });

  it("pulls the pid out with sed, since the far side has no JSON parser", () => {
    // The lock is written by JSON.stringify, so `"pid":<digits>` is a stable shape.
    expect(readServerStateCommand()).toMatch(/sed -n .*pid.*\[0-9\]/);
  });
});

describe("parseServerState", () => {
  it("a lock plus the alive marker is a running server, with its port", () => {
    expect(parseServerState(`${lock()}\n${SERVER_ALIVE_MARK}\n`)).toEqual({
      kind: "running",
      port: 7364,
      pid: 4242,
    });
  });

  it("a lock WITHOUT the marker is stopped — the file outlives the process", () => {
    // This is the case that matters: a killed server leaves its lock behind, and reporting
    // that as running would point the page at a port nothing answers on.
    expect(parseServerState(`${lock()}\n`)).toEqual({ kind: "stopped" });
  });

  it("no output at all is stopped: nothing installed there is serving", () => {
    expect(parseServerState("")).toEqual({ kind: "stopped" });
    expect(parseServerState("\n")).toEqual({ kind: "stopped" });
  });

  it("a damaged or partial lock reads as stopped, never as running", () => {
    expect(parseServerState(`{ not json\n${SERVER_ALIVE_MARK}\n`)).toEqual({ kind: "stopped" });
    expect(parseServerState(`${lock({ port: undefined })}\n${SERVER_ALIVE_MARK}\n`)).toEqual({
      kind: "stopped",
    });
    expect(parseServerState(`${lock({ pid: "4242" })}\n${SERVER_ALIVE_MARK}\n`)).toEqual({
      kind: "stopped",
    });
    expect(parseServerState(`${lock({ port: 7364.5 })}\n${SERVER_ALIVE_MARK}\n`)).toEqual({
      kind: "stopped",
    });
  });
});
