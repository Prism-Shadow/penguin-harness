/**
 * What a conversation on a machine says while that machine is out of reach: its history lives
 * there, so a failed read is the machine's state, not the conversation's. Read from the one live
 * machines account (state/machines.tsx) through `machineLink`, the same reading the composer and
 * the Agent settings page take, so the chat never disagrees with the Machines page.
 */
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { ApiError, S, machineLink } from "@prismshadow/penguin-web/internal";
import { readMachine, retryReading } from "@prismshadow/penguin-web/internal-hub";
import { MachineLink } from "@prismshadow/penguin-web/internal";
import type { RetryReading } from "@prismshadow/penguin-web/internal-hub";

export interface MachineAway {
  link: Exclude<MachineLink, "connected" | "unknown">;
  /** The machine's list entry; null when this Project's list does not have it. */
  machine: MachineInfo | null;
  /** One sentence: the machine by its alias, and its link state. */
  headline: string;
  /** The retry status while the server brings it back or stopped trying; null otherwise. */
  retry: RetryReading | null;
}

/**
 * The away reading for the machine a conversation is on; null while it is connected, and while
 * the list has not answered yet (nothing is known to be wrong with it).
 */
export function machineAway(
  state: MachinesResponse | null,
  settled: boolean,
  machineId: string,
): MachineAway | null {
  const link = machineLink(state, settled, machineId);
  if (link === "connected" || link === "unknown") return null;
  const machine = state?.machines.find((m) => !m.local && m.machineId === machineId) ?? null;
  const words = S.chat.machineAway;
  if (link === "missing" || machine === null) {
    return { link: "missing", machine: null, headline: words.missing, retry: null };
  }
  const alias = machine.alias;
  return {
    link,
    machine,
    headline: words[link](alias),
    retry: retryReading(readMachine(machine, null, state?.imageVersion ?? null), alias),
  };
}

/** Why a conversation's history read stopped waiting for its machine, in the hub's words. */
export type StoppedReason = "not_connected" | "unreachable" | "retrying";

/**
 * Why a history read gave up on its machine — its retries ran out with nothing moving (503
 * `machine_unreachable`, the last attempt's reason in `details.reason`) — or null when `cause` is
 * any other failure. A reason this build does not know reads as the machine not answering.
 */
export function stoppedWaiting(cause: unknown): StoppedReason | null {
  if (!(cause instanceof ApiError) || cause.code !== "machine_unreachable") return null;
  const reason = cause.details?.reason;
  return reason === "not_connected" || reason === "unreachable" ? reason : "retrying";
}

/**
 * Whether the machines account lists the machine and reads it as away: the machine a conversation
 * is on is known to be down, so its reads wait (nothing is asked of it) and its offline view
 * shows. A machine the list does not have, or has not answered about yet, is not known to be down:
 * its reads say for themselves where it stands.
 */
export function listedAway(
  state: MachinesResponse | null,
  settled: boolean,
  machineId: string,
): boolean {
  return machineAway(state, settled, machineId)?.machine != null;
}

/**
 * The machine a conversation is on while it reads as needing a restart — its server answers
 * requests and never takes the API socket, so none of the conversation's live updates arrive —
 * read exactly as its card on the Machines page reads it; null otherwise, and while the list has
 * not answered.
 */
export function machineRestartNeeded(
  state: MachinesResponse | null,
  machineId: string,
): MachineInfo | null {
  const machine = state?.machines.find((m) => !m.local && m.machineId === machineId) ?? null;
  if (machine === null) return null;
  const reading = readMachine(machine, null, state?.imageVersion ?? null);
  return reading.kind === "restartNeeded" ? machine : null;
}
