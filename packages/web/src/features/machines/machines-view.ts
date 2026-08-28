/**
 * What the Machines page's controls offer, decided as data rather than in JSX.
 *
 * The server keeps ONE job at a time — an install or a connect — so the install button is
 * governed by which machine is SELECTED and which machine the job belongs to: they come
 * apart when someone picks a second host while the first installs. "Already installed"
 * comes from the machine's own persisted record, not from the job.
 */
import type { MachineInfo, MachineJob, MachinesResponse } from "@prismshadow/penguin-server/api";

/** The finished job's verdict, in the shape the page renders. */
export type MachineVerdict =
  | { kind: "installed"; version: string | null }
  | { kind: "already-installed"; version: string | null }
  | { kind: "connected" }
  | { kind: "failed"; step: string; message: string };

/** How a machine's server reads right now, for the row that renders it. */
export type StatusTone = "busy" | "success" | "attention" | "danger" | "muted";

export interface InstallButtonState {
  /**
   * What the button offers. `update` is a reinstall onto a machine carrying a DIFFERENT
   * build from the one this server would send. `adopt` is an install on a machine this
   * server already installed for another Project: it short-circuits after one probe, and
   * what it writes is this Project's membership.
   */
  action: "adopt" | "install" | "installing" | "reinstall" | "update";
  /** True when the button must not start anything: nothing selected, a job running, a POST in flight, or no image. */
  disabled: boolean;
}

export function verdictOf(job: MachineJob): MachineVerdict | null {
  if (job.result === null) return null;
  if (!job.result.ok) {
    return { kind: "failed", step: job.result.step, message: job.result.message };
  }
  if ("connected" in job.result) return { kind: "connected" };
  return { kind: job.result.installed, version: job.result.version };
}

export function installButtonState(
  selected: MachineInfo | null,
  state: MachinesResponse,
  starting: boolean,
): InstallButtonState {
  const job = state.job;
  const runningSomewhere = job?.running === true;
  const selectedIsRunning =
    runningSomewhere && job.kind === "install" && job.machineId === selected?.id;
  return {
    action:
      selectedIsRunning || starting
        ? "installing"
        : selected?.installed == null
          ? selected?.elsewhere != null
            ? "adopt"
            : "install"
          : outOfDate(selected, state.imageVersion)
            ? "update"
            : "reinstall",
    disabled:
      selected === null ||
      selected.local ||
      runningSomewhere ||
      starting ||
      state.imageVersion === null,
  };
}

/** Only an unreachable machine is a problem worth colouring as one; stopped is settled. */
export function statusTone(state: string | undefined): StatusTone {
  if (state === "running") return "success";
  if (state === "unreachable") return "danger";
  return "muted";
}

/**
 * The machines this server has installed on, most recently installed first. Ties keep the
 * config's order, so the list is stable between polls. The local entry is kept out: it is
 * where you are, not something you did.
 */
export function installedMachines(state: MachinesResponse): MachineInfo[] {
  return state.machines
    .map((machine, index) => ({ machine, index }))
    .filter((entry) => entry.machine.installed != null && !entry.machine.local)
    .sort((a, b) => {
      const at = b.machine.installed!.at.localeCompare(a.machine.installed!.at);
      return at !== 0 ? at : a.index - b.index;
    })
    .map((entry) => entry.machine);
}

/** The local entry, which the server always puts first. */
export function localMachine(state: MachinesResponse): MachineInfo | null {
  return state.machines.find((machine) => machine.local) ?? null;
}

/** What the connect control offers for one machine. */
export type ConnectAction = "unavailable" | "connected" | "connecting" | "connect";

export function connectAction(
  machine: MachineInfo,
  job: MachineJob | null,
  starting: string | null,
): ConnectAction {
  if (machine.local || machine.installed === null) return "unavailable";
  if (starting === machine.id) return "connecting";
  if (job?.running === true && job.kind === "connect" && job.machineId === machine.id) {
    return "connecting";
  }
  return machine.connected ? "connected" : "connect";
}

/**
 * True when a machine carries a different build from the one this server would install.
 * Any difference, not "older": pushed versions are content hashes, which do not order.
 * False while the local image is unknown — with nothing to compare against, "behind" would
 * be a guess dressed as a fact.
 */
export function outOfDate(machine: MachineInfo, imageVersion: string | null): boolean {
  if (imageVersion === null || machine.local || machine.installed === null) return false;
  return machine.installed.version !== imageVersion;
}
