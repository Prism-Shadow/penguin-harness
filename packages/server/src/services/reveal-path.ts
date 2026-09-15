/**
 * Showing a file in the machine's own file manager — what the Files panel's "Show in folder"
 * asks for, and only ever on the machine this server runs on.
 *
 * Two of the three platforms can point at the file itself: Finder takes `-R`, Explorer takes
 * `/select,`. A Linux desktop has no portable way to ask for a selection, so it gets the
 * containing directory, which is the part of the request that always holds.
 *
 * Nothing here waits for the file manager — it outlives the request that opened it, so the
 * child is detached, given no stdio and unref'd. What IS awaited is the spawn itself: a
 * command that is not on the machine at all (a headless box has no `xdg-open`) has to reach
 * the caller as a failure rather than as a window that never appeared.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { FileReveal } from "../mechanisms/workspace.js";

/** The command that reveals `filePath` on `platform`. Pure; exported for unit tests. */
export function revealCommand(
  platform: string,
  filePath: string,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: ["-R", filePath] };
  // `explorer.exe /select,<path>` is the documented form, and the comma belongs to the switch:
  // the switch and the path have to arrive as two separate arguments for the file to be
  // selected — joined into one, Explorer opens the user's home directory instead.
  if (platform === "win32") return { command: "explorer.exe", args: ["/select,", filePath] };
  return { command: "xdg-open", args: [path.dirname(filePath)] };
}

/**
 * Opens `filePath`'s directory in the file manager, selecting the file where the platform
 * allows. Resolves as soon as the process has started; rejects when it cannot be started at
 * all. `platform` and `spawnImpl` exist for the unit test — production passes neither.
 */
export function revealInFileManager(
  filePath: string,
  opts?: { platform?: string; spawnImpl?: typeof spawn },
): Promise<void> {
  const { command, args } = revealCommand(opts?.platform ?? process.platform, filePath);
  const spawnChild = opts?.spawnImpl ?? spawn;
  return new Promise<void>((resolve, reject) => {
    const child = spawnChild(command, args, { detached: true, stdio: "ignore" });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
    child.on("error", reject);
  });
}

/** The reveal as a node, so a test stands in for the spawn rather than opening a window. */
@Component()
export class RevealService implements FileReveal {
  /** The opener a reveal goes through; a replacement supplies its own. */
  private readonly opener: (filePath: string) => Promise<void> = revealInFileManager;

  reveal(filePath: string): Promise<void> {
    return this.opener(filePath);
  }
}
