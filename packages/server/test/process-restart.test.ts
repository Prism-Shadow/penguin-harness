/**
 * The restart step reads the supervisor's announcement off this process's environment and
 * leaves through the runtime's own SIGTERM path with the restart code
 * (services/process-restart.ts) — nothing claimed from the runtime, so a platform pushed
 * onto any runtime carries it, including one whose shutdown ends in `process.exit(0)`.
 */
import { SERVER_RESTART_EXIT_CODE } from "@prismshadow/penguin-core";
import { describe, expect, it } from "vitest";
import { processRestart } from "../src/services/process-restart.js";
import type { RestartableProcess } from "../src/services/process-restart.js";

interface FakeProcess extends RestartableProcess {
  raised: string[];
  /** The code this process would really leave with: what an `exit` listener leaves behind. */
  leave(explicit?: number): number | string | null | undefined;
}

/** A process with no SIGTERM shutdown registered unless `onSigterm` is given. */
function fakeProcess(onSigterm?: () => void): FakeProcess {
  const raised: string[] = [];
  const exiting: Array<() => void> = [];
  const self: FakeProcess = {
    exitCode: undefined,
    raised,
    emit(event, signal) {
      raised.push(`${event}:${signal}`);
      if (onSigterm === undefined) return false;
      onSigterm();
      return true;
    },
    once(_event, listener) {
      exiting.push(listener);
    },
    off(_event, listener) {
      const at = exiting.indexOf(listener);
      if (at !== -1) exiting.splice(at, 1);
    },
    leave(explicit) {
      // Node's order: an explicit `process.exit(code)` sets the code, then the `exit`
      // listeners run and may still change it — the last word.
      if (explicit !== undefined) self.exitCode = explicit;
      for (const listener of exiting) listener();
      return self.exitCode;
    },
  };
  return self;
}

describe("processRestart", () => {
  it("is supervised exactly when `penguin server|web` announced itself", () => {
    expect(processRestart({ PENGUIN_SUPERVISED: "1" }, fakeProcess()).supervised()).toBe(true);
    expect(processRestart({}, fakeProcess()).supervised()).toBe(false);
    expect(processRestart({ PENGUIN_SUPERVISED: "true" }, fakeProcess()).supervised()).toBe(false);
  });

  it("leaves through the SIGTERM handlers with the restart code preset", () => {
    const proc = fakeProcess(() => {});
    processRestart({ PENGUIN_SUPERVISED: "1" }, proc).request();
    expect(proc.exitCode).toBe(SERVER_RESTART_EXIT_CODE);
    expect(proc.raised).toEqual(["SIGTERM:SIGTERM"]);
    expect(proc.leave()).toBe(SERVER_RESTART_EXIT_CODE);
  });

  it("leaves with the restart code on a runtime whose shutdown forces 0", () => {
    // Every runtime built before this change ends its graceful shutdown with an explicit
    // `process.exit(0)`, and a hot push cannot replace it: the supervisor would stand down.
    const proc = fakeProcess(() => {});
    processRestart({ PENGUIN_SUPERVISED: "1" }, proc).request();
    expect(proc.leave(0)).toBe(SERVER_RESTART_EXIT_CODE);
  });

  it("leaves the process untouched when nothing listens for SIGTERM", () => {
    const proc = fakeProcess();
    const lines: string[] = [];
    processRestart({ PENGUIN_SUPERVISED: "1" }, proc, (line) => lines.push(line)).request();
    expect(proc.exitCode).toBeUndefined();
    expect(proc.leave(0)).toBe(0);
    expect(lines).toEqual([
      "[server] restart requested, but this runtime has no SIGTERM shutdown to leave through",
    ]);
  });
});
