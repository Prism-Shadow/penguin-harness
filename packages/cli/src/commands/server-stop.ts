/**
 * `penguin server stop` — stops the server on this data root, and answers in one line of JSON.
 *
 * Machine-facing, like `penguin server status`: a CONTROLLER runs it over ssh. It lives here
 * rather than as an HTTP call to the server itself because it has to work on a server whose
 * PLATFORM is older than this build — a machine mid-upgrade, which is exactly when something
 * needs stopping. A platform route can only be relied on once the machine already runs it,
 * and the reason it needs stopping is usually that it does not.
 *
 * A signal, not a shell `kill`: the controller has no portable way to send one (`kill` and
 * `taskkill` are different commands with different spellings), while `process.kill` is the
 * same call on every platform this runs on.
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import { liveServerLock, readServerLock } from "@prismshadow/penguin-server/lock";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";
import { resolveRootOption } from "../root-option.js";

/** How long a server that was signalled gets to let go of its lock. */
const STOP_TIMEOUT_MS = 15_000;

/** What the command prints. `stopped` is the outcome; `pid` names what was signalled. */
interface StopResult {
  ok: boolean;
  pid?: number;
  detail?: string;
}

export function registerStopCommand(server: Command, t: Messages): void {
  server
    .command("stop")
    .description(t.serverStop.desc)
    .option("--root <dir>", t.common.root)
    .action(async (opts: { root?: string }) => {
      const result = await stop(resolveRootOption(opts.root));
      process.stdout.write(JSON.stringify(result) + "\n");
      if (!result.ok) process.exitCode = 1;
    });
}

async function stop(root: string): Promise<StopResult> {
  // Already stopped is the outcome asked for, not a failure: the caller wants nothing serving
  // this root, and nothing is.
  const lock = await liveServerLock(root);
  if (lock === null) return { ok: true };
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    return { ok: true }; // Gone between the read and the signal — again, the outcome asked for.
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  for (;;) {
    if ((await liveServerLock(root)) === null) return { ok: true, pid: lock.pid };
    if (Date.now() >= deadline) {
      // Deliberately no SIGKILL: this server holds a database and may be finishing a task,
      // and a controller deciding to destroy that on a timeout is not its call to make.
      return {
        ok: false,
        pid: lock.pid,
        detail: `it still holds ${readServerLock(root)?.port ?? "its port"} 15s after SIGTERM`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
