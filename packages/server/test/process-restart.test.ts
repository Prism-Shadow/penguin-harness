/**
 * The restart step reads the supervisor's announcement off this process's environment and
 * leaves through the runtime's own SIGTERM path with the restart code preset
 * (services/process-restart.ts) — nothing claimed from the runtime, so a platform pushed
 * onto any runtime carries it.
 */
import { SERVER_RESTART_EXIT_CODE } from "@prismshadow/penguin-core";
import { describe, expect, it } from "vitest";
import { processRestart } from "../src/services/process-restart.js";
import type { RestartableProcess } from "../src/services/process-restart.js";

function fakeProcess(): RestartableProcess & { raised: string[] } {
  const raised: string[] = [];
  return {
    exitCode: undefined,
    raised,
    emit(event, signal) {
      raised.push(`${event}:${signal}`);
      return true;
    },
  };
}

describe("processRestart", () => {
  it("is supervised exactly when `penguin server|web` announced itself", () => {
    expect(processRestart({ PENGUIN_SUPERVISED: "1" }, fakeProcess()).supervised()).toBe(true);
    expect(processRestart({}, fakeProcess()).supervised()).toBe(false);
    expect(processRestart({ PENGUIN_SUPERVISED: "true" }, fakeProcess()).supervised()).toBe(false);
  });

  it("leaves through the SIGTERM handlers with the restart code preset", () => {
    const proc = fakeProcess();
    processRestart({ PENGUIN_SUPERVISED: "1" }, proc).request();
    expect(proc.exitCode).toBe(SERVER_RESTART_EXIT_CODE);
    expect(proc.raised).toEqual(["SIGTERM:SIGTERM"]);
  });
});
