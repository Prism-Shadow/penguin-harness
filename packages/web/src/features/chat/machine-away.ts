/**
 * What a conversation on a machine says while that machine is out of reach: its history lives
 * there, so a failed read is the machine's state, not the conversation's. Read from the one live
 * machines account (state/machines.tsx) through `machineLink`, the same reading the composer and
 * the Agent settings page take, so the chat never disagrees with the Machines page.
 */
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { machineLink } from "../../lib/machine-link";
import type { MachineLink } from "../../lib/machine-link";
import { S } from "../../lib/strings";
import { readMachine, retryReading } from "../machines/machines-view";
import type { RetryReading } from "../machines/machines-view";

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
