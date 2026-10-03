/**
 * What the add dialog derives without a DOM: the hosts its first tab offers, the line under each
 * name, and what pressing Add asks of the server.
 *
 * The rows are the hosts in this server's ssh config that are not on this page yet — not this
 * server, not in this Project's list — in the config's order, narrowed by the search the way the
 * old picker narrowed it (machines-match.ts). Beside each name, muted, is what that host's own
 * block says about reaching it: `user@host:port`, the default port unsaid, as the Machine dialog
 * says it.
 */
import type {
  MachineInfo,
  MachinesResponse,
  SshHostSummary,
} from "@prismshadow/penguin-server/api";
import { matchMachines } from "./machines-match";
import type { MachineMatch } from "./machines-match";
import { machinesInUse } from "./machines-view";

/** The dialog's tabs, in order; it opens on the first. */
export const ADD_TABS = ["config", "manual"] as const;
export type AddTab = (typeof ADD_TABS)[number];

/** One host the first tab offers: the machine, where its alias matched, and how it is reached. */
export interface HostRow extends MachineMatch<MachineInfo> {
  /** `user@host:port` from its own block; null when the block says nothing beyond the name. */
  reach: string | null;
}

/** `user@host:port` as a host's own block spells it, the default port unsaid; null when it says nothing. */
export function reachLine(summary: SshHostSummary | undefined): string | null {
  if (summary === undefined) return null;
  const { alias, hostName, user, port } = summary;
  if (hostName === undefined && user === undefined && port === undefined) return null;
  const at = user === undefined || user === "" ? "" : `${user}@`;
  const colon = port === undefined || port === 22 ? "" : `:${port}`;
  return `${at}${hostName ?? alias}${colon}`;
}

/** The hosts not on the page yet: in the config, not this server, not in this Project's list. */
export function addableMachines(state: MachinesResponse): MachineInfo[] {
  const inUse = new Set(machinesInUse(state).map((machine) => machine.id));
  return state.machines.filter((machine) => !machine.local && !inUse.has(machine.id));
}

/** The first tab's rows for a search, with each host's reach from the config's own lines. */
export function hostRows(
  state: MachinesResponse,
  hosts: readonly SshHostSummary[],
  query: string,
): HostRow[] {
  const byAlias = new Map(hosts.map((host) => [host.alias, host]));
  return matchMachines(addableMachines(state), query).map((match) => ({
    ...match,
    reach: reachLine(byAlias.get(match.machine.alias)),
  }));
}

/**
 * What Add asks of the server: the ssh host to write first (the manual tab), then the machines
 * to put on this Project's list — enabling them too (`use`, which installs and connects) when the
 * box under the form is ticked, or only adding them (`add`).
 */
export interface AddPlan {
  writeHost: boolean;
  machines: string[];
  verb: "use" | "add";
}

export function addPlan(
  tab: AddTab,
  picked: readonly string[],
  alias: string,
  installNow: boolean,
): AddPlan {
  const verb = installNow ? "use" : "add";
  return tab === "config"
    ? { writeHost: false, machines: [...picked], verb }
    : { writeHost: true, machines: [`ssh:${alias.trim()}`], verb };
}
