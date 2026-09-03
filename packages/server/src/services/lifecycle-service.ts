import { Interface } from "@prismshadow/penguin-core/kernel";

/**
 * Process lifecycle as a runtime capability: whether a supervisor relaunches this process
 * when it exits, and the restart trigger the platform's `POST /api/version/restart` pulls
 * once a self-update is installed.
 *
 * The supervisor is `penguin server|web`, which runs the service as a child process and
 * respawns it on SERVER_RESTART_EXIT_CODE (core); it announces itself with
 * PENGUIN_SUPERVISED=1. Under anything else — the server entry started directly, a dev
 * run, the desktop shell (which updates the whole app, not the server) — a restart request
 * is refused rather than honored: exiting would stop the service with nobody to bring it
 * back, and the page tells the user to restart by hand instead.
 *
 * Mechanism only: what a restart is *for* is the platform's business (the update flow);
 * this class knows how to leave, and who is there to catch it.
 */
export abstract class Lifecycle extends Interface<
  Pick<LifecycleService, "supervised" | "onRestartRequest" | "requestRestart">
>() {}

export class LifecycleService {
  private restartHandler: (() => void) | null = null;

  constructor(private readonly supervisedFlag: boolean) {}

  /** Whether a supervisor relaunches this process on the restart exit code (PENGUIN_SUPERVISED=1). */
  supervised(): boolean {
    return this.supervisedFlag;
  }

  /** index.ts registers the graceful-shutdown-then-restart trigger after listen(). */
  onRestartRequest(handler: () => void): void {
    this.restartHandler = handler;
  }

  /** Invoked by the restart route; false when unsupervised, or when no handler is registered (tests). */
  requestRestart(): boolean {
    if (!this.supervisedFlag || !this.restartHandler) return false;
    this.restartHandler();
    return true;
  }
}
