/**
 * Which machines a workspace can be picked on, and how each is labelled.
 *
 * A workspace is a directory ON a machine. Only one whose filesystem is reachable right now
 * can be browsed: this one always, and any other with a live tunnel. Every installed machine
 * is LISTED regardless, the unreachable ones disabled with their reason at the row — a list
 * that silently omits its answer is indistinguishable from a broken feature. Identified by
 * machine id and labelled by ssh alias.
 */
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";

/** One machine a workspace can live on, and whether it can be browsed right now. */
export interface WorkspaceMachine {
  /** The machine's own id; null means the local server (which needs no proxy prefix). */
  id: string | null;
  /** The ssh alias, or this host's name for the local entry. */
  label: string;
  /** True for the machine serving this page. */
  local: boolean;
  /** False when its filesystem cannot be reached; `reason` says what is missing. */
  selectable: boolean;
  /** Why it cannot be browsed, for the row to render. Absent when it can. */
  reason?: "no-identity";
}

/**
 * Every machine, local first: the ones that can be browsed, and the installed ones that
 * cannot, each with its reason.
 *
 * Hosts nothing was ever installed on are the one thing left out — they are not part of
 * this feature yet, and listing 45 ssh entries as 45 failures would bury the two that
 * matter. Being installed is what makes a machine a candidate; everything from there on
 * says why it is or is not usable.
 */
export function workspaceMachines(state: MachinesResponse | null): WorkspaceMachine[] {
  if (state === null) return [];
  const out: WorkspaceMachine[] = [];
  for (const machine of state.machines) {
    if (machine.local) {
      out.push({ id: null, label: machine.alias, local: true, selectable: true });
      continue;
    }
    if (machine.installed === null) continue;
    if (machine.machineId === null) {
      // Installed, but nothing has minted an identity there yet — a workspace stored
      // against it could never be matched back, so it cannot be chosen.
      out.push({
        id: null,
        label: machine.alias,
        local: false,
        selectable: false,
        reason: "no-identity",
      });
      continue;
    }
    // A tunnel is NOT required: this server browses that machine's directories over ssh
    // (see the machines service's listDirs). The tunnel is for reaching that machine's own
    // API, which picking a workspace does not do — requiring one here made a connect a
    // prerequisite for reading a directory listing, which it never was.
    out.push({ id: machine.machineId, label: machine.alias, local: false, selectable: true });
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

/** True when a workspace lives on some machine other than this one. */
export function isElsewhere(workspaceMachineId: string | null | undefined): boolean {
  return (workspaceMachineId ?? null) !== null;
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
