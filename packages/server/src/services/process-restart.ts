/**
 * Restarting into the installed release, done from inside the process with nothing claimed
 * from the runtime.
 *
 * The supervisor is `penguin server|web`: it runs the service as a child, announces itself
 * with PENGUIN_SUPERVISED=1 in the child's environment, and relaunches the child when it
 * exits with core's SERVER_RESTART_EXIT_CODE. Both halves of what the restart route needs
 * are therefore already here — the announcement is in this process's environment, and the
 * exit is the runtime's own graceful shutdown, the one it registers on SIGTERM. Under
 * anything else (a direct start, a dev run through tsx, the desktop shell, which updates
 * the whole app) nobody would bring the process back, so the route refuses instead of
 * leaving.
 *
 * Raised as the SIGTERM event rather than sent as a signal: the handlers are the same, and
 * Windows delivers no signals at all — `process.kill` there is a hard termination.
 *
 * Leaving with the restart code has to survive the runtime this platform was pushed onto.
 * The current one hands its shutdown's exit to `process.exitCode` (index.ts), but every
 * runtime built before this change ends that shutdown with an explicit `process.exit(0)`,
 * which would stop the service with the supervisor standing down — so the code is also
 * forced from an `exit` listener, the last word Node gives anyone, and both runtimes leave
 * with 75. The listener is the compatibility half: it can go once no supported runtime
 * forces 0 (see the changelog entry).
 */
import { SERVER_RESTART_EXIT_CODE } from "@prismshadow/penguin-core";

export interface RestartControl {
  /** Whether a supervisor relaunches this process on the restart exit code. */
  supervised(): boolean;
  /** Leaves for the supervisor to relaunch. Only meaningful when supervised. */
  request(): void;
}

/** The process this platform runs in: what `request` needs of it. */
export interface RestartableProcess {
  exitCode: number | string | null | undefined;
  emit(event: "SIGTERM", signal: "SIGTERM"): boolean;
  once(event: "exit", listener: () => void): unknown;
  off(event: "exit", listener: () => void): unknown;
}

export function processRestart(
  env: NodeJS.ProcessEnv = process.env,
  proc: RestartableProcess = process,
  log: (line: string) => void = (line) => console.error(line),
): RestartControl {
  return {
    supervised: () => env.PENGUIN_SUPERVISED === "1",
    request: () => {
      const previous = proc.exitCode;
      const force = () => {
        proc.exitCode = SERVER_RESTART_EXIT_CODE;
      };
      proc.exitCode = SERVER_RESTART_EXIT_CODE;
      proc.once("exit", force);
      if (proc.emit("SIGTERM", "SIGTERM")) return;
      // No listener: this runtime does not shut down on SIGTERM, so the process is not
      // leaving at all. Put it back exactly as it was found — a forced exit code left on a
      // process that keeps running would have the supervisor relaunch its next ordinary exit.
      proc.off("exit", force);
      proc.exitCode = previous;
      log("[server] restart requested, but this runtime has no SIGTERM shutdown to leave through");
    },
  };
}
