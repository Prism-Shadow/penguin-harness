/**
 * What the Machines page's install control offers, decided as data rather than in JSX.
 *
 * The server keeps ONE install job at a time, so the button is governed by two things that
 * are not the same: which machine is SELECTED in the picker, and which machine the job (if
 * any) belongs to. They come apart the moment someone picks a second host while the first
 * is still installing — the button must refuse, but the running job's log still belongs on
 * screen, under the alias it is actually installing to. That is why the job panel renders
 * from `state.job` directly and only the button consults the selection.
 *
 * "Already installed" is a THIRD thing, and it comes from the machine's own persisted
 * record rather than from the job: the job is one slot, so deriving it from there made an
 * installed machine vanish as soon as anything else was installed or the server restarted.
 */
import type {
  MachineInfo,
  MachineInstallJob,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";

/** The finished job's verdict, in the shape the page renders. */
export type MachineVerdict =
  | { kind: "installed"; version: string | null }
  | { kind: "already-installed"; version: string | null }
  | { kind: "failed"; step: string; message: string };

export interface InstallButtonState {
  /** What the button offers: a fresh install, one already under way, or a repeat of a finished one. */
  action: "install" | "installing" | "reinstall";
  /**
   * True when the button must not start anything: nothing is selected, a job is running
   * anywhere (one at a time, server-side), this page's own POST is in flight, or this
   * server has no image to send at all.
   */
  disabled: boolean;
}

/** The verdict of a job that has finished, or null while it is still running. */
export function verdictOf(job: MachineInstallJob): MachineVerdict | null {
  if (job.result === null) return null;
  if (job.result.ok) return { kind: job.result.kind, version: job.result.version };
  return { kind: "failed", step: job.result.step, message: job.result.message };
}

/**
 * `starting` is true while a POST has not come back yet. It exists because the server has
 * no job to report during that window, and a button that stays on "Install" through a click
 * reads as a click that did nothing.
 */
export function installButtonState(
  selected: MachineInfo | null,
  state: MachinesResponse,
  starting: boolean,
): InstallButtonState {
  const job = state.job;
  const runningSomewhere = job?.running === true;
  const selectedIsRunning = runningSomewhere && job.machineId === selected?.id;
  return {
    action:
      selectedIsRunning || starting
        ? "installing"
        : selected?.installed != null
          ? "reinstall"
          : "install",
    disabled: selected === null || runningSomewhere || starting || state.imageVersion === null,
  };
}

/**
 * The machines this server has installed on, most recently installed first — the standing
 * answer to "what did I already do", which the picker can only give one row at a time and
 * only while it is open.
 *
 * Newest first because the list is read to check recent work, not to look a host up: the
 * picker's search is what finds a specific alias. Ties (two installs in the same
 * millisecond, which the tests do produce) keep the config's order rather than swapping
 * around, so the list is stable between polls.
 *
 * Records whose host is no longer declared in the ssh config never reach here: the server
 * builds the list from the config, so a renamed or deleted Host drops out of the page while
 * its record sits harmlessly in the file. There is nothing useful to offer for a host this
 * server can no longer resolve, let alone install to.
 */
export function installedMachines(state: MachinesResponse): MachineInfo[] {
  return state.machines
    .map((machine, index) => ({ machine, index }))
    .filter((entry) => entry.machine.installed != null)
    .sort((a, b) => {
      const at = b.machine.installed!.at.localeCompare(a.machine.installed!.at);
      return at !== 0 ? at : a.index - b.index;
    })
    .map((entry) => entry.machine);
}
