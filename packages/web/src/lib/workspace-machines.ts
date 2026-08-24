/**
 * Which machines a workspace can be picked on, and how each is labelled.
 *
 * A workspace is a directory ON a machine, so choosing one means choosing where the path
 * has to exist. Only a machine whose filesystem is reachable right now can be BROWSED: this
 * one always, and any other with a live tunnel. One that is merely installed has no route to
 * browse over.
 *
 * But "cannot be offered" is not the same as "must not be mentioned". A control that
 * disappears when there is nothing to choose teaches nobody anything — it just looks like
 * the feature is missing. So the unreachable ones are COUNTED and reported, and the picker
 * says how many machines are one connect away rather than silently showing a list of one.
 *
 * Identified by machine id and labelled by ssh alias, the same split as everywhere else:
 * the alias is what someone recognises, the id is what gets stored.
 */
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";

/** One machine a workspace can live on. `id` is null for the local one. */
export interface WorkspaceMachine {
  /** The machine's own id; null means the local server (which needs no proxy prefix). */
  id: string | null;
  /** The ssh alias, or this host's name for the local entry. */
  label: string;
  /** True for the machine serving this page. */
  local: boolean;
}

/** What the picker's machine row has to say: what can be chosen, and what is missing. */
export interface WorkspaceMachineOffer {
  /** Machines whose filesystem can be browsed right now, local first. */
  machines: WorkspaceMachine[];
  /**
   * Installed machines that cannot be browsed yet — no live tunnel, or no identity to store
   * a workspace against. Reported as a count so the row can say why the list is short
   * instead of leaving someone to wonder whether the feature works.
   */
  unreachable: number;
}

/**
 * The offer, local first. A machine without an identity is not offerable even when
 * connected — a workspace stored against a machine that cannot be named could never be
 * matched back to it — but it is still counted, because from the outside "installed but
 * not usable yet" is a state worth seeing.
 */
export function workspaceMachineOffer(state: MachinesResponse | null): WorkspaceMachineOffer {
  if (state === null) return { machines: [], unreachable: 0 };
  const machines: WorkspaceMachine[] = [];
  let unreachable = 0;
  for (const machine of state.machines) {
    if (machine.local) {
      machines.push({ id: null, label: machine.alias, local: true });
      continue;
    }
    if (machine.origin !== null && machine.machineId !== null) {
      machines.push({ id: machine.machineId, label: machine.alias, local: false });
      continue;
    }
    // Hosts nothing was ever installed on are not "unreachable", they are simply not part
    // of this feature yet; counting them would turn a 45-line ssh config into alarm.
    if (machine.installed !== null) unreachable++;
  }
  return { machines, unreachable };
}

/** The offerable machines alone (the common case for callers that only render the list). */
export function workspaceMachines(state: MachinesResponse | null): WorkspaceMachine[] {
  return workspaceMachineOffer(state).machines;
}

/**
 * The label for a chosen machine id. Falls back to the id itself: a workspace may have been
 * registered on a machine that has since disconnected or dropped out of the ssh config, and
 * showing the raw id is honest where inventing a name would not be.
 */
export function machineLabel(machines: WorkspaceMachine[], id: string | null): string | null {
  const found = machines.find((machine) => machine.id === id);
  if (found !== undefined) return found.label;
  return id;
}

/** True when this workspace's machine is not the one the window is currently working on. */
export function isElsewhere(workspaceMachineId: string | null, activeId: string | null): boolean {
  return (workspaceMachineId ?? null) !== (activeId ?? null);
}

/** The machine a directory picked on `machine` should be recorded against. */
export function recordedMachineId(machine: WorkspaceMachine | undefined): string | undefined {
  // Absent rather than null for the local machine: an entry with no machine is one picked
  // where the app was, which is every entry that existed before machines did.
  return machine === undefined || machine.local ? undefined : (machine.id ?? undefined);
}

/** Reads the machine off a machine list entry, for callers holding a raw MachineInfo. */
export const machineIdOf = (machine: MachineInfo): string | null =>
  machine.local ? null : machine.machineId;
