/**
 * Restarting into the installed release, done from inside the process with nothing claimed
 * from the runtime.
 *
 * The supervisor is `penguin server|web`: it runs the service as a child, announces itself
 * with PENGUIN_SUPERVISED=1 in the child's environment, and relaunches the child when it
 * exits with core's SERVER_RESTART_EXIT_CODE. Both halves of what the restart route needs
 * are therefore already here — the announcement is in this process's environment, and the
 * exit is the runtime's own graceful shutdown, the one it registers on SIGTERM, leaving with
 * the restart code instead of 0: that shutdown honours a code preset on `process.exitCode`.
 * Under anything else (a direct start, a dev run through tsx, the desktop shell, which
 * updates the whole app) nobody would bring the process back, so the route refuses instead
 * of leaving.
 *
 * Raised as the SIGTERM event rather than sent as a signal: the handlers are the same, and
 * Windows delivers no signals at all — `process.kill` there is a hard termination.
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
}

export function processRestart(
  env: NodeJS.ProcessEnv = process.env,
  proc: RestartableProcess = process,
): RestartControl {
  return {
    supervised: () => env.PENGUIN_SUPERVISED === "1",
    request: () => {
      proc.exitCode = SERVER_RESTART_EXIT_CODE;
      proc.emit("SIGTERM", "SIGTERM");
    },
  };
}
