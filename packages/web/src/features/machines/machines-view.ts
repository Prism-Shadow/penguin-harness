/**
 * What one row of the Machines page shows, decided as data rather than in JSX.
 *
 * The server keeps ONE install job at a time, so at most one row owns it and every other
 * row's button is disabled while it runs. That coupling — a job on the response, a decision
 * per row — is the whole logic of the page, and it is the part worth pinning in tests; the
 * component only maps the result onto strings and tones.
 */
import type { MachineInstallJob, MachinesResponse } from "@prismshadow/penguin-server/api";

/** The finished job's verdict, in the shape the row renders. */
export type MachineVerdict =
  | { kind: "installed"; version: string | null }
  | { kind: "already-installed"; version: string | null }
  | { kind: "failed"; step: string; message: string };

export interface MachineRowState {
  /** What the button offers: a fresh install, one already under way, or a repeat of a finished one. */
  action: "install" | "installing" | "reinstall";
  /**
   * True when this button must not start anything: a job is running anywhere (one at a
   * time), this row's own POST is in flight, or this server has no image to send at all.
   */
  disabled: boolean;
  /** True while THIS row's install is the running one — the row also says so in words. */
  running: boolean;
  /** The verdict, only on the row the finished job belongs to. */
  verdict: MachineVerdict | null;
  /** The job's progress lines, only on the row the job belongs to. */
  log: readonly string[];
}

/** The verdict of a job that has finished, or null while it is still running. */
export function verdictOf(job: MachineInstallJob): MachineVerdict | null {
  if (job.result === null) return null;
  if (job.result.ok) return { kind: job.result.kind, version: job.result.version };
  return { kind: "failed", step: job.result.step, message: job.result.message };
}

/**
 * `starting` is the row whose POST has not come back yet. It exists because the server has
 * no job to report during that window, and a button that stays on "Install" through a click
 * reads as a click that did nothing.
 */
export function machineRowState(
  machineId: string,
  state: MachinesResponse,
  starting: string | null,
): MachineRowState {
  const job = state.job;
  const owns = job !== null && job.machineId === machineId;
  const runningSomewhere = job?.running === true;
  const running = owns && runningSomewhere;
  const verdict = owns && !runningSomewhere ? verdictOf(job) : null;
  return {
    action:
      running || starting === machineId ? "installing" : verdict === null ? "install" : "reinstall",
    disabled: runningSomewhere || starting !== null || state.imageVersion === null,
    running,
    verdict,
    log: owns ? job.log : [],
  };
}
