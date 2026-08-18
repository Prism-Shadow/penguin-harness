import { describe, expect, it } from "vitest";
import { CommandSessionManager } from "../src/environment/tools/command/session-manager.js";

describe("CommandSessionManager.removeExited", () => {
  it("removes an exited process but refuses a running process", () => {
    const manager = new CommandSessionManager();
    const running = { running: true, kill() {}, killHard() {} } as never;
    const exited = { running: false, kill() {}, killHard() {} } as never;
    const runningId = manager.register(running);
    const exitedId = manager.register(exited);

    expect(manager.removeExited(runningId)).toBe(false);
    expect(manager.list()).toHaveLength(2);
    expect(manager.removeExited(exitedId)).toBe(true);
    expect(manager.list()).toHaveLength(1);
    manager.dispose();
  });
});
