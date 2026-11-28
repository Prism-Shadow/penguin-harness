/**
 * The plugin market across the Project's machines (pure decisions, unit tested): which rows the
 * page shows for the machine picked in its header, and where each row's actions go.
 *
 * Reading and writing have different owners, and this module is where the split is kept:
 *
 * - **Every machine is read.** A machine's library (what its Agents can install), its registry
 *   index (what its own sources offer) and the server modules it runs come from that machine,
 *   through this server's proxy (machine-markets.ts). A card shows what its machine has.
 * - **A server module has one record: the Project's tables on this server.** Which modules a
 *   machine runs is `[plugins]` plus `[plugins.<machineId>]` in this server's Project config, and
 *   the fleet sync hands that list to the machine, where it lands as the machine's shared table.
 *   So a machine's module rows take what is listed — and whether a Remove is this page's to make
 *   — from this server's tables, and only the state (running, failed, not there yet) from the
 *   machine. Read from the machine alone, every synced module would look shared, and one listed
 *   for that machine only could not be removed. A module write names the machine and goes to
 *   this server, which records it and syncs; the machine downloads the package from its own
 *   sources when the list arrives.
 * - **An Agent's plugins are that Agent's server's.** Installing a library plugin on a machine's
 *   Agent goes to that machine (agent-writes.ts); a machine's card offers that machine's Agents.
 *
 * "All machines" (the header's default) shows this server's rows, then each machine's row that
 * says something this server's does not: a package this server does not have, another version,
 * or a module in another state there. A row from a machine carries `origin`, and its card names
 * the machine.
 */
import type {
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
} from "@prismshadow/penguin-server/api";
import type { InstallTarget } from "./plugin-card";
import { moduleParts, pluginRows, type PluginRow } from "./plugin-groups";

/** What one machine answered the market, as last read. */
export interface MachineMarketData {
  machineId: string;
  /** Its alias: what its cards write. */
  label: string;
  /** Its library, its registry index and the modules it runs; null before each has answered. */
  library: PluginGroupItem[] | null;
  index: PluginIndexEntry[] | null;
  running: InstalledPluginsResponse | null;
  /** Whether each of those is the machine's word right now (connected, answered in this load). */
  libraryLive: boolean;
  indexLive: boolean;
  runningLive: boolean;
}

/**
 * The header's choice: every machine, or one — this server's id, a machine's, or undefined for
 * this server while its id is not read yet.
 */
export type MarketView = { all: true } | { all: false; machineId: string | undefined };

/** A row's identity on the page: a machine's keys are its own, beside this server's. */
const machineKey = (machineId: string, key: string) => `${machineId}/${key}`;

/**
 * One machine's rows: its library's plugins, and the server modules as this server's Project
 * tables list them for it (`tables`), each in the state the machine reports, then what its own
 * index and build offer beside them.
 */
export function machineRows(
  machine: MachineMarketData,
  tables: InstalledPluginsResponse | null,
): PluginRow[] {
  const { machineId, label } = machine;
  const parts = moduleParts(tables, machine.index ?? [], { machineId, remote: machine.running });
  return pluginRows(machine.library ?? [], parts).map((row) => ({
    ...row,
    key: machineKey(machineId, row.key),
    origin: {
      machineId,
      label,
      live: row.library
        ? machine.libraryLive
        : machine.runningLive && (row.module?.entry ? machine.indexLive : true),
    },
  }));
}

/** The package a row stands for: its library plugin's package, or its module's. */
const packageOf = (row: PluginRow) => row.library?.package ?? row.module?.specifier ?? row.name;

/**
 * "All machines": this server's rows, then each machine's row that differs from this server's
 * card for the same package — a package this server does not list, a library plugin of another
 * version (or one this server has as a module only), or a module listed or running there in a
 * state this server's card does not show. A machine's row that would say what this server's
 * already says is folded into it.
 */
export function combinedMarketRows(
  local: readonly PluginRow[],
  machines: readonly (readonly PluginRow[])[],
): PluginRow[] {
  const here = new Map(local.map((row) => [packageOf(row), row]));
  return [
    ...local,
    ...machines.flatMap((rows) =>
      rows.filter((row) => {
        const other = here.get(packageOf(row));
        if (other === undefined) return true;
        if (row.library && (!other.library || other.library.version !== row.library.version))
          return true;
        return (
          row.module !== undefined &&
          row.module.state !== "none" &&
          row.module.state !== other.module?.state
        );
      }),
    ),
  ];
}

/**
 * The rows for the header's choice: every machine's (above), this server's alone, or one
 * machine's. A machine the page cannot read a market of — named by a table, but not one of the
 * administrator's enrolled machines — shows the modules this server's tables list for it, in the
 * state `fallback` (its own list, read through the proxy) reports.
 */
export function marketRows(
  view: MarketView,
  local: {
    groups: readonly PluginGroupItem[];
    /** This server's Project tables and what it runs; null before they have answered. */
    tables: InstalledPluginsResponse | null;
    index: readonly PluginIndexEntry[];
  },
  machines: readonly MachineMarketData[],
  fallback: InstalledPluginsResponse | null,
): PluginRow[] {
  const here = pluginRows(local.groups, moduleParts(local.tables, local.index));
  if (view.all) {
    return combinedMarketRows(
      here,
      machines.map((machine) => machineRows(machine, local.tables)),
    );
  }
  if (view.machineId === undefined || view.machineId === local.tables?.machineId) return here;
  const machine = machines.find((m) => m.machineId === view.machineId);
  if (machine !== undefined) return machineRows(machine, local.tables);
  return pluginRows(
    [],
    moduleParts(local.tables, local.index, { machineId: view.machineId, remote: fallback }),
  );
}

/**
 * The Agents a row's library plugin can go on: every Agent for this server's row (a machine's
 * Agent included: the install runs there), that machine's Agents for a machine's row.
 */
export function rowTargets(row: PluginRow, targets: readonly InstallTarget[]): InstallTarget[] {
  const origin = row.origin;
  return origin === undefined
    ? [...targets]
    : targets.filter((t) => t.machine?.machineId === origin.machineId);
}

/** The Agent a machine's card falls back to when none of its Agents has the plugin yet. */
const DEFAULT_AGENT_ID = "default_agent";

/**
 * The Agent a card's one-step install and quick start act on: for this server's card, the
 * current Agent, when it is this server's; for a machine's, a connected Agent of that machine
 * that already has the whole plugin (`complete`), else its default Agent, else its first
 * connected one. None while no such Agent is there — the card then asks which.
 */
export function rowCurrentTarget(
  row: PluginRow,
  choices: readonly InstallTarget[],
  currentAgentId: string | undefined,
  complete: (target: InstallTarget) => boolean,
): InstallTarget | undefined {
  if (row.origin === undefined) {
    return choices.find((t) => t.machine === null && t.agent.agentId === currentAgentId);
  }
  const connected = choices.filter((t) => t.machine !== null && t.machine.live !== false);
  return (
    connected.find(complete) ??
    connected.find((t) => t.agent.agentId === DEFAULT_AGENT_ID) ??
    connected[0]
  );
}

/**
 * The machine a row's server-module write is listed for, in this server's Project tables: the
 * machine the row came from, else the machine in view (this server's own id under "All machines"
 * and "This server"). Undefined until this server's id is known.
 */
export function moduleTarget(row: PluginRow, viewMachine: string | undefined): string | undefined {
  return row.origin?.machineId ?? viewMachine;
}

/**
 * Whether a row's controls wait: a machine's Agent installs need the machine connected, and the
 * server modules are written one at a time. A machine's module row does not wait for its
 * machine — the write is this server's, and the machine takes the list when it connects.
 */
export function rowBlocked(
  row: PluginRow,
  viewMachine: string | undefined,
  pendingSpecifier: string | null,
): boolean {
  if (row.library !== undefined && row.origin?.live === false) return true;
  return (
    row.module !== undefined &&
    (moduleTarget(row, viewMachine) === undefined ||
      (pendingSpecifier !== null && pendingSpecifier !== row.module.specifier))
  );
}

/** The card's package-update offer reads this server's own install: a machine's row has none. */
export const offersPackageUpdate = (row: PluginRow): boolean => row.origin === undefined;
