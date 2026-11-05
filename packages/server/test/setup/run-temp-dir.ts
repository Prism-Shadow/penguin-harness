/**
 * The run's own temporary directory. Setup makes one directory under the OS temp directory and
 * points TMPDIR / TEMP / TMP at it, so everything the suite writes there — test roots, what the
 * code under test creates, the processes it spawns — lands inside it. Teardown names what is
 * still there (a test or a process that outlived its cleanup) and removes the directory, so a run
 * leaves nothing behind on the machine whatever its tests did.
 *
 * It is a subdirectory of the usual one, so a test still sees the platform's own temp path
 * (macOS's /var/folders/…, a Windows runner's 8.3 short name) in front of its roots.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VARIABLES = ["TMPDIR", "TEMP", "TMP"] as const;

/**
 * Not a test's leftovers: the caches tools keep there (Node's compile cache, tsx's), and the IPC
 * files the .NET runtime leaves behind a PowerShell (pwsh) whose terminal a test closed, as it
 * would for any user's terminal. They go with the directory all the same.
 */
const NOT_LEFTOVERS =
  /^(node-compile-cache|tsx-\d+|CoreFxPipe_.+|clr-debug-pipe-.+|dotnet-diagnostic-.+)$/;

export default function setup(): () => void {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-"));
  const saved = VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of VARIABLES) process.env[name] = runDir;
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const left = fs.readdirSync(runDir).filter((name) => !NOT_LEFTOVERS.test(name));
    if (left.length > 0) {
      const shown = left.slice(0, 20).join("\n  ");
      const more = left.length > 20 ? `\n  … and ${left.length - 20} more` : "";
      console.warn(
        `[temp] ${left.length} temporary entr${left.length === 1 ? "y" : "ies"} outlived the tests that made ${left.length === 1 ? "it" : "them"} (removed now):\n  ${shown}${more}`,
      );
    }
    try {
      fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      console.warn(`[temp] could not remove ${runDir}: ${(error as Error).message}`);
    }
  };
}
