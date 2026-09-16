/**
 * The desktop "show in folder" opener: the per-platform command, and the spawn it waits on
 * (start, not exit). Nothing here starts a real process.
 */
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { revealCommand, revealInFileManager } from "../src/services/reveal-path.js";

/**
 * A spawn that records its call and then behaves like a child that either started or could
 * not. The event is emitted on the next tick because a real one is: emitting it inside the
 * call would fire before the opener has attached its listeners.
 */
function fakeSpawn(outcome: "spawn" | "error") {
  const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
  let unrefs = 0;
  const impl = ((command: string, args: string[], options: unknown) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {
      unrefs += 1;
    };
    setImmediate(() => {
      if (outcome === "spawn") child.emit("spawn");
      else child.emit("error", new Error("spawn xdg-open ENOENT"));
    });
    return child;
  }) as unknown as typeof spawn;
  return { impl, calls, unrefCount: () => unrefs };
}

describe("revealCommand", () => {
  it("selects the file on macOS and Windows, and opens the directory everywhere else", () => {
    expect(revealCommand("darwin", "/Users/ada/ws/report.md")).toEqual({
      command: "open",
      args: ["-R", "/Users/ada/ws/report.md"],
    });
    // The switch and the path are two arguments: joined into one, Explorer ignores the file.
    expect(revealCommand("win32", "C:\\ws\\report.md")).toEqual({
      command: "explorer.exe",
      args: ["/select,", "C:\\ws\\report.md"],
    });
    expect(revealCommand("linux", "/home/ada/ws/report.md")).toEqual({
      command: "xdg-open",
      args: ["/home/ada/ws"],
    });
  });
});

describe("revealInFileManager", () => {
  it("resolves once the child has started, detached and unref'd, without waiting for it to exit", async () => {
    const fake = fakeSpawn("spawn");
    await expect(
      revealInFileManager("/ws/report.md", { platform: "darwin", spawnImpl: fake.impl }),
    ).resolves.toBeUndefined();
    expect(fake.calls).toEqual([
      {
        command: "open",
        args: ["-R", "/ws/report.md"],
        options: { detached: true, stdio: "ignore" },
      },
    ]);
    // The fake never ends its child: resolving at all is what proves nothing awaits the exit.
    expect(fake.unrefCount()).toBe(1);
  });

  it("rejects with the spawn error when the command is not on the machine", async () => {
    const fake = fakeSpawn("error");
    await expect(
      revealInFileManager("/ws/report.md", { platform: "linux", spawnImpl: fake.impl }),
    ).rejects.toThrow(/ENOENT/);
    expect(fake.unrefCount()).toBe(0);
  });
});
