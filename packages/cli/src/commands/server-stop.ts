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

/**
 * What this command does to the world, injectable so a test can drive every outcome
 * without a server to signal: the signal itself, the liveness of a pid, the clock, and the
 * platform — Windows is where a signal is not what it says it is.
 */
export interface StopEffects {
  kill: (pid: number, signal: NodeJS.Signals | 0) => void;
  platform: NodeJS.Platform;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** What the command prints. `ok` is the outcome; `pid` names what was signalled. */
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

const realEffects: StopEffects = {
  kill: (pid, signal) => process.kill(pid, signal),
  platform: process.platform,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The error code a signal came back with, or null for anything that is not one. */
function codeOf(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : null;
}

export async function stop(root: string, fx: StopEffects = realEffects): Promise<StopResult> {
  // Already stopped is the outcome asked for, not a failure: the caller wants nothing serving
  // this root, and nothing is.
  const lock = await liveServerLock(root);
  if (lock === null) return { ok: true };
  // On Windows a "SIGTERM" from Node is not delivered to anything: the process is ended
  // outright, which skips the drain this command exists to allow — the database, a task
  // mid-flight. Refused rather than performed as if it were the same thing.
  if (fx.platform === "win32") {
    return {
      ok: false,
      pid: lock.pid,
      detail:
        "a graceful stop cannot be signalled on Windows; stop the server from its own console.",
    };
  }
  try {
    fx.kill(lock.pid, "SIGTERM");
  } catch (err) {
    // ESRCH: gone between the read and the signal — again, the outcome asked for. Anything
    // else — EPERM above all — means a live server this account could not signal, and it is
    // still serving.
    if (codeOf(err) === "ESRCH") return { ok: true };
    return {
      ok: false,
      pid: lock.pid,
      detail: `it could not be signalled (${codeOf(err) ?? err})`,
    };
  }
  const deadline = fx.now() + STOP_TIMEOUT_MS;
  for (;;) {
    // Stopped means the PROCESS is gone, or the lock is no longer its. The listener closing
    // is neither: a server drains after it stops accepting — still holding the lock and the
    // database — and a restart started on the listener's word alone would open SQLite
    // beside a process that has not let go of it yet.
    let alive = true;
    try {
      fx.kill(lock.pid, 0);
    } catch (err) {
      alive = codeOf(err) === "EPERM";
    }
    if (!alive) return { ok: true, pid: lock.pid };
    const held = readServerLock(root);
    if (held === null || held.pid !== lock.pid) return { ok: true, pid: lock.pid };
    if (fx.now() >= deadline) {
      // Deliberately no SIGKILL: this server holds a database and may be finishing a task,
      // and a controller deciding to destroy that on a timeout is not its call to make.
      return {
        ok: false,
        pid: lock.pid,
        detail: `it still holds ${held.port} 15s after SIGTERM`,
      };
    }
    await fx.sleep(250);
  }
}
