/**
 * Which machines a workspace can be picked on, and how each is labelled.
 *
 * A workspace is a directory ON a machine, so choosing one means choosing where the path
 * has to exist. Only machines whose filesystem is reachable right now can be offered: this
 * machine always, and any other machine with a live tunnel. One that is installed but not
 * connected has no route to browse over — it is left out rather than offered and then
 * failing at the first click.
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

/**
 * The offerable machines, local first. Anything without an identity is skipped even when
 * connected: a workspace stored against a machine that cannot be named could never be
 * matched back to it.
 */
export function workspaceMachines(state: MachinesResponse | null): WorkspaceMachine[] {
  if (state === null) return [];
  const out: WorkspaceMachine[] = [];
  for (const machine of state.machines) {
    if (machine.local) {
      out.push({ id: null, label: machine.alias, local: true });
      continue;
    }
    if (machine.origin === null || machine.machineId === null) continue;
    out.push({ id: machine.machineId, label: machine.alias, local: false });
  }
  return out;
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
