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
  MachineConnectJob,
  MachineInfo,
  MachineInstallJob,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";

/** The finished job's verdict, in the shape the page renders. */
export type MachineVerdict =
  | { kind: "installed"; version: string | null }
  | { kind: "already-installed"; version: string | null }
  | { kind: "failed"; step: string; message: string; canReplaceProgram?: true };

/** How a machine's server reads right now, for the row that renders it. */
export type StatusTone = "busy" | "success" | "attention" | "danger" | "muted";

export interface InstallButtonState {
  /**
   * What the button offers. `update` is a reinstall onto a machine carrying a DIFFERENT
   * build from the one this server would send — the case worth naming, because a machine
   * that is merely behind looks identical to one that is current until you read two version
   * strings side by side.
   *
   * `adopt` is the one that is not an install at all: this server already installed there,
   * for another Project, so the program is in place and only this Project's membership is
   * missing. It takes no ssh and no transfer, and it must not be spelled "install" — that
   * would offer a 30 MB round trip as the way to write one line of JSON.
   */
  action: "adopt" | "install" | "installing" | "reinstall" | "update";
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
  return {
    kind: "failed",
    step: job.result.step,
    message: job.result.message,
    ...(job.result.canReplaceProgram === true ? { canReplaceProgram: true as const } : {}),
  };
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
        : selected?.installed == null
          ? // Installed for another Project: adopting is the whole job, and it is free.
            selected?.elsewhere != null
            ? "adopt"
            : "install"
          : outOfDate(selected, state.imageVersion)
            ? "update"
            : "reinstall",
    disabled:
      selected === null ||
      // This machine is the one answering the request; it cannot be a target of itself.
      selected.local ||
      runningSomewhere ||
      starting ||
      state.imageVersion === null,
  };
}

/**
 * The tone a status reads in. `running` and `stopped` are both ordinary outcomes, so only an
 * unreachable machine is a problem worth colouring as one; a stopped server is settled, not
 * broken, and an unprobed machine has nothing to say yet.
 */
export function statusTone(state: string | undefined): StatusTone {
  if (state === "running") return "success";
  if (state === "unreachable") return "danger";
  if (state === "stopped") return "muted";
  return "muted";
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
  return (
    state.machines
      .map((machine, index) => ({ machine, index }))
      // The local entry is pinned to the front rather than sorted in: it is where you are,
      // not something you did, and its timestamp is this process's start.
      .filter((entry) => entry.machine.installed != null && !entry.machine.local)
      .sort((a, b) => {
        const at = b.machine.installed!.at.localeCompare(a.machine.installed!.at);
        return at !== 0 ? at : a.index - b.index;
      })
      .map((entry) => entry.machine)
  );
}

/** The local entry, which the server always puts first. */
export function localMachine(state: MachinesResponse): MachineInfo | null {
  return state.machines.find((machine) => machine.local) ?? null;
}

/** What the connect control offers for one machine. */
export type ConnectAction =
  /** Nothing installed there yet: connect has nothing to start. */
  | "unavailable"
  /** A tunnel is up; this window can be pointed at it. */
  | "connected"
  /** A connect is running for this machine right now. */
  | "connecting"
  /** Installed, not connected. */
  | "connect";

export function connectAction(
  machine: MachineInfo,
  connect: MachineConnectJob | null,
  starting: string | null,
): ConnectAction {
  if (machine.local || machine.installed === null) return "unavailable";
  if (starting === machine.id) return "connecting";
  if (connect?.running === true && connect.machineId === machine.id) return "connecting";
  return machine.origin === null ? "connect" : "connected";
}

/**
 * True when a machine carries a different build from the one this server would install.
 *
 * Any difference, not "older": versions here are content hashes of a pushed build
 * (`0.0.0-hmr.<cli>.<web>`), which do not order. What matters is whether the two ends agree,
 * and they either do or they do not.
 *
 * False while the local image is unknown — with nothing to compare against, claiming a
 * machine is behind would be a guess dressed as a fact.
 */
export function outOfDate(machine: MachineInfo, imageVersion: string | null): boolean {
  if (imageVersion === null || machine.local || machine.installed === null) return false;
  return machine.installed.version !== imageVersion;
}

/** Whether this browser holds a session on a machine, as the row renders it. */
export type MachineSignIn = "unknown" | "signed-in" | "signed-out";

/**
 * Whether a machine can be signed in to right now.
 *
 * Only a connected one: the sign-in goes through that machine's tunnel, so without one
 * there is nothing to reach. And only a machine with an identity, since the proxy is
 * addressed by it — a sign-in has nowhere to be namespaced to otherwise.
 */
export function canSignIn(machine: MachineInfo): boolean {
  return !machine.local && machine.origin !== null && machine.machineId !== null;
}
