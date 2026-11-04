/**
 * How a surface outside the Machines page reads one machine by its own id: whether it can be
 * asked anything right now, and if not, why — taken from the one live account of the machines
 * (state/machines.tsx), the same one the Machines page shows. A surface that judged a machine by
 * whether its own last request went through kept its answer after the machine came back.
 */
import type { MachinesResponse } from "@prismshadow/penguin-server/api";
import { S } from "./strings";

export type MachineLink =
  /** Connected, and nothing is being brought back: its API answers. */
  | "connected"
  /** The server is bringing it back: ask again once it is connected. */
  | "reconnecting"
  /** The server stopped bringing it back: a Retry on the Machines page starts again. */
  | "reconnectStopped"
  /** Its stored password was refused: nothing brings it back until its SSH settings change. */
  | "signInRefused"
  /** Installed, and its server stopped — or never connected since. */
  | "stopped"
  /** On the list with nothing installed there yet. */
  | "notConnected"
  /** Not on this Project's machine list at all: an id left from before, or not this user's to see. */
  | "missing"
  /** The list has not answered yet. */
  | "unknown";

export function machineLink(
  state: MachinesResponse | null,
  settled: boolean,
  machineId: string,
): MachineLink {
  if (state === null) return settled ? "missing" : "unknown";
  const machine = state.machines.find((entry) => !entry.local && entry.machineId === machineId);
  if (machine === undefined) return "missing";
  if (machine.reconnect?.waitsForPassword === true) return "signInRefused";
  if (machine.reconnect?.gaveUp !== undefined) return "reconnectStopped";
  if (machine.reconnect !== undefined) return "reconnecting";
  if (machine.connection !== null) return "connected";
  return machine.installed === null ? "notConnected" : "stopped";
}

/**
 * The new-chat composer's Agent picker while nothing is on offer: why, for a workspace on a
 * machine — the machine's state as the Machines page shows it, or that machine's own failure once
 * it is connected — and plain loading otherwise (`link` null: the workspace is on this server).
 */
export function remoteAgentsEmpty(link: MachineLink | null, failure: string | null): string {
  const c = S.machines.composer;
  switch (link) {
    case "reconnecting":
      return c.reconnecting;
    case "reconnectStopped":
      return c.reconnectStopped;
    case "signInRefused":
      return c.signInRefused;
    case "stopped":
      return c.stopped;
    case "notConnected":
      return c.notConnected;
    case "missing":
      return c.missing;
    case "connected":
      return failure === null ? S.common.loading : c.failed(failure);
    default:
      return S.common.loading;
  }
}
