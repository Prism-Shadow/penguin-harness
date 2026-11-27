/**
 * Everything the plugin market reads and does, shared by its two pages — the market's grid
 * (plugins-page.tsx) and a plugin's own page (plugin-page.tsx): the library, the registry, the
 * curation, the Project's tables and each machine's market, the Agents a plugin can go on and
 * what each holds, every plugin's status, and the writes — an Agent's install and uninstall, a
 * server module's install, update and removal (through server-installs.ts, so a change runs on
 * across the pages), the server uninstall, quick start and the bulk update — with the
 * confirmations they open (`dialogs`, which both pages mount).
 *
 * - A library plugin is installed per Agent, by any member, from its install steps, and
 *   uninstalled there by the Project owner; the update nudge appears when the server lists some
 *   Agent's copy as behind (`AgentSummary.pluginUpdates` — the market never compares versions
 *   itself), and the notice under the title updates every outdated plugin at once. Installed
 *   means the whole plugin: every one of its skills in the Agent's installed skills, its hook
 *   package (when it ships one) in the Agent's installed hooks, and each of its MCP servers among
 *   the Agent's servers as an entry it installed — which is why the market reads the three lists
 *   per Agent (agent-installs.ts). The steps list this server's Agents and each machine's own in
 *   one list, in the Agents page's order (lib/machine-agent-lists.ts `mixAgents`): a machine's
 *   Agent is installed on, read back from and updated on that machine, from that machine's
 *   library, and counts towards the card's "used by" and status — with what the machine last
 *   answered while it is out of reach. The update notice and the nav badge it answers are this
 *   server's alone.
 * - A server module is installed on the whole server for every Project, by an admin only (a
 *   member sees its button held). Installing or removing one re-assembles the App, so its server
 *   step says what the install does and, in small type below, what it costs.
 * - **Machines**: for an administrator of a Project with machines, the header's machine picker
 *   opens on "All machines" — this server's cards, then each machine's card that says something
 *   this server's does not, named after its machine — and narrows to this server or one machine;
 *   the pick is kept for the Project while the person moves between the market's pages. Every
 *   machine is read (machine-markets.ts); a server module is written only through this server's
 *   Project tables, which the fleet sync hands to the machine, and an Agent's plugin on the
 *   Agent's own server (market-rows.ts).
 *
 * Every read keeps its last answer (lib/read-store.ts): coming back to a page shows what it
 * showed, an answer is read again behind it, and a status, a count or a row's state changes only
 * when an answer says something different — never because a read is in flight, failed, or a
 * machine dropped out of reach.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AgentSummary,
  PluginHoldersResponse,
  PluginItem,
  QuickStartItem,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  ImpactList,
  ICONS,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { isConversationAgent } from "../../lib/builtin-agents";
import { apiErrorText } from "../../lib/api-error";
import { useUpdateBadges, dismissTodo, bulkOutcome, failedList, firstFailure } from "../todos";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useMachines } from "../../state/machines";
import { useSessions } from "../../state/sessions";
import { agentKey } from "../../lib/agent-location";
import { mixAgents, useMachineAgents } from "../../lib/machine-agent-lists";
import { readKey, useRead } from "../../lib/read-store";
import type { MachineChoice } from "../machines";
import { DRAFT_SESSION_ID, draftKey, loadDraft, saveDraft, prepareNewChatDraft } from "../chat";
import { localizedText } from "../../lib/skill-use";
import { PackageUpdateDialog, packageUpdate, type PackageUpdate } from "./plugin-package-update";
import { usePluginRepair } from "./plugin-repair";
import { useMachineMarkets } from "./machine-markets";
import {
  marketRows,
  moduleTarget,
  offersPackageUpdate,
  rowBlocked,
  rowCurrentTarget,
  rowTargets,
} from "./market-rows";
import { viewedMachine } from "./viewed-machine";
import { SettingsDialog } from "../settings";
import { pickDefaultAgent } from "../ai-create";
import { pluginPickItems } from "../agents";
import { appWindowPath } from "../../lib/app-center-path";
import { ModuleApplyBody, libraryQuickStart } from "./plugin-card";
import type { InstallTarget, PluginCardProps } from "./plugin-card";
import { rowTitle } from "./plugin-marks";
import { artOf, isSelected } from "./plugin-market";
import {
  INDEX_KEY,
  LIBRARY_KEY,
  MARKET_KEY,
  installedPlugins,
  installedPluginsKey,
  pluginIndex,
  pluginLibrary,
  pluginMarket,
  useLocalPluginIndex,
} from "./plugin-reads";
import { notifyPluginsChanged } from "../../lib/project-change-events";
import {
  agentInstalls,
  readNewAgentInstalls,
  rereadInstalls,
  useAgentInstalls,
  type InstallsTarget,
} from "./agent-installs";
import { installOnAgent, toastWriteError, uninstallFromAgent } from "./agent-plugin-writes";
import { toastInstall } from "../../lib/agent-plugin-install";
import { useOnPluginModulesChanged, usePluginModuleRequests } from "../../lib/plugin-modules";
import { StdioInstallBody } from "./plugin-mcp";
import { ImportPluginModal } from "./plugin-import-modal";
import { pluginCategories, type PluginRow } from "./plugin-groups";
import {
  installNeedsConfirm,
  libraryUsage,
  pluginComplete,
  pluginStatus,
  type AgentInstalls,
  type InstalledMap,
  type LibraryUsage,
  type PluginStatus,
} from "./plugin-status";
import { toastApiError, toastFailure } from "../../lib/toast-api-error";
import { toldFailure } from "../../lib/failure";
import { pressOpensElsewhere } from "../../lib/shortcuts/link-press";
import {
  dismissServerFailure,
  runKey,
  runServerChange,
  useRunningChange,
  useServerRuns,
} from "./server-installs";

const NO_INSTALLS: AgentInstalls = { skills: new Map(), hooks: new Map(), mcp: new Map() };

/** The market's own address; a plugin's page is under it (`/plugins/<name>`). */
export const PLUGINS_PATH = "/plugins";

/** This server's reads are read again on every visit, however recent the last answer. */
const EVERY_VISIT = { minAgeMs: 0 };

/** The picker's value for this server until its id is read: no machine id is empty. */
export const SELF_PENDING = "";
/** The picker's value for every machine at once; no machine id is `*`. */
export const ALL_MACHINES = "*";

/** The machine each Project's market was last narrowed to, for the page load. */
const pickedMachines = new Map<string, string | null>();

/**
 * What updating EVERY outdated plugin on this page would write, grouped the way it is sent.
 *
 * Read off `AgentSummary.pluginUpdates` — the same field the plugins gate counts — so the plan
 * and the notice above the button cannot describe different work. One request per Agent rather
 * than one per (Agent, plugin): the install endpoint already takes a list of names, and an Agent
 * behind on four plugins is one overwrite either way.
 *
 * `plugins` is the distinct library plugins across the whole plan, sorted, which is what the
 * confirmation lists and what the notice counts — the page shows the library once, so an update
 * touching five Agents is still one plugin to the reader.
 */
export interface PluginUpdatePlan {
  perAgent: { agentId: string; names: string[] }[];
  plugins: string[];
}

export function pluginUpdatePlan(
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "pluginUpdates">>,
): PluginUpdatePlan {
  const perAgent: { agentId: string; names: string[] }[] = [];
  const plugins = new Set<string>();
  for (const agent of agents) {
    const names = agent.pluginUpdates.map((u) => u.name).sort();
    if (names.length === 0) continue;
    perAgent.push({ agentId: agent.agentId, names });
    for (const name of names) plugins.add(name);
  }
  return { perAgent, plugins: [...plugins].sort() };
}

export function usePluginMarket() {
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  const { currentProject, agents, agentsLoading, currentAgent, setCurrentAgentId, reloadAgents } =
    useProject();
  const { repair, modal: repairModal } = usePluginRepair(agents);
  const projectId = currentProject?.projectId ?? null;

  /** The plugins trail's raised badge, or undefined — the notice under the title acts on it or clears it. */
  const todo = useUpdateBadges().todos.plugins;
  /** The bulk update is running: its confirmation (the market page's) waits on it. */
  const [bulkRunning, setBulkRunning] = useState(false);

  /** The library, as last answered; a failed read shows only while there is no answer at all. */
  const library = useRead(
    pluginLibrary,
    LIBRARY_KEY,
    () => api.getPluginLibrary(null),
    EVERY_VISIT,
  );
  const groups = library.value?.groups ?? null;
  const error = groups === null ? library.failure : null;
  /** The same library as the Create agent dialog's picker rows, for 「新建空白 Agent」. */
  const pickLibrary = useMemo(
    () => (groups === null ? null : pluginPickItems(groups.flatMap((g) => g.plugins))),
    [groups],
  );
  // A return to the same Project is a new visit, not permission for an old reply: a write that
  // answers in a later visit is not taken (its Project's list is read again on entry anyway).
  const projectVisit = useRef({ projectId, userId, generation: 0 });
  if (projectVisit.current.projectId !== projectId || projectVisit.current.userId !== userId) {
    projectVisit.current = { projectId, userId, generation: projectVisit.current.generation + 1 };
  }
  const visit = projectVisit.current;
  const isCurrentVisit = () => projectVisit.current === visit;
  /** What this Project asks for of the module plugins, and which of those this server runs. */
  const deploymentKey = projectId === null ? null : installedPluginsKey(projectId, null);
  const deploymentRead = useRead(
    installedPlugins,
    deploymentKey,
    () => api.getInstalledPlugins(projectId!, null),
    EVERY_VISIT,
  );
  const deployment = deploymentRead.value;
  /** The registry, as last answered; a failed re-read keeps the rows it listed. */
  const registry = useLocalPluginIndex(true);
  const index = registry.value?.plugins ?? (registry.error !== null ? [] : null);
  /**
   * Sources that answered with nothing. A published index that is down shortens the list
   * instead of emptying it (the server merges tolerantly), so the page has to say so — a
   * silently shorter list reads as "that plugin does not exist".
   */
  const indexFailures = registry.value?.failures ?? [];
  /**
   * How many sources the server was still reading when it last answered. It answers without a
   * published index that is slow to arrive (on a network that cannot reach it, that is every
   * retry the fetch is allowed), so the shipped entries list at once, and the page reads again
   * until the source has answered or failed. A re-read that failed stops the reading.
   */
  const indexPending = registry.error === null ? (registry.value?.pending?.length ?? 0) : 0;
  /** The server changes of this Project, as the store keeps them across pages (server-installs.ts). */
  const runs = useServerRuns(projectId);
  /** The one running, if any: the list is written one change at a time. */
  const running = useRunningChange(projectId);
  const pendingSpecifier = running?.specifier ?? null;
  /**
   * A server uninstall waiting for its confirmation (05 「插件库」 「安装模型」): the package, its
   * name, the machine in view, and who would lose it — null until the server has said.
   */
  const [pendingServerUninstall, setPendingServerUninstall] = useState<{
    specifier: string;
    name: string;
    machineId: string;
    holders: PluginHoldersResponse | null;
    error: string | null;
  } | null>(null);
  const [serverUninstalling, setServerUninstalling] = useState(false);
  const isAdmin = user?.isAdmin === true;
  const isOwner = currentProject?.role === "owner";
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The Settings page the dialog opens on: plugin sources from the header, the requests from their notice. */
  const [settingsSection, setSettingsSection] = useState<"plugins" | "moduleRequests">("plugins");
  /** The administrator's requests to run plugins' server modules on this server, for the notice. */
  const moduleRequests = usePluginModuleRequests(null, isAdmin);
  /** The import dialog (admin) is open. */
  const [importOpen, setImportOpen] = useState(false);

  /**
   * The curation: what is selected, what may lead, and the art; null until it answers, and for
   * good when it cannot (a server older than the market answers 404) — generated covers.
   */
  const market = useRead(pluginMarket, MARKET_KEY, () => api.getPluginMarket(), EVERY_VISIT).value;

  const { machineIds, machineLabels } = useSessions();
  /** Every machine of the Project with its Agents, reachable or not (lib/machine-agent-lists.ts). */
  const { lists: machineLists, reload: reloadMachineAgents } = useMachineAgents(projectId);
  /**
   * The machine picked in the header; null shows every machine's cards ("All machines"). Kept for
   * the Project across the market's pages, so Back from a plugin's page shows the same cards.
   */
  const [pickedMachine, pickMachine] = useState<string | null>(() =>
    projectId === null ? null : (pickedMachines.get(projectId) ?? null),
  );
  const setPickedMachine = (id: string | null) => {
    if (projectId !== null) pickedMachines.set(projectId, id);
    pickMachine(id);
  };
  /** Installs written on an Agent and not answered yet, by target key: what the dialog shows meanwhile. */
  const [writing, setWriting] = useState<ReadonlyMap<string, AgentInstalls>>(() => new Map());
  const firstVisit = useRef(visit);
  useEffect(() => {
    // The first visit of this mount keeps the pick it remembered; a Project switch drops it.
    if (firstVisit.current === visit) return;
    pickMachine(projectId === null ? null : (pickedMachines.get(projectId) ?? null));
    setPendingApply(null);
    setWriting((m) => (m.size === 0 ? m : new Map()));
  }, [visit]);
  const selfId = deployment?.machineId;
  /** Each machine's library, index and running modules, read on that machine (machine-markets.ts). */
  const machineMarkets = useMachineMarkets(projectId);
  const allMachines = pickedMachine === null;
  /** The machines whose cards on screen stand as last answered: named in a note under the header. */
  const offlineMarkets = machineMarkets.filter(
    (m) => m.unavailable && (allMachines || pickedMachine === m.machineId),
  );
  /** The Project's machines as the machine list has them: alias, and whether each can be asked now. */
  const listedMachine = (machineId: string) =>
    machineLists.find((list) => list.machine.machineId === machineId)?.machine;
  const nameOf = (machineId: string) =>
    machineId === selfId
      ? S.plugins.thisServer
      : (listedMachine(machineId)?.label ?? machineLabels.get(machineId) ?? machineId);
  /** A machine of the list that cannot be asked right now (one only a table names is not known to be). */
  const outOfReach = (machineId: string) => {
    const link = listedMachine(machineId)?.link;
    return link !== undefined && link !== "connected";
  };
  // The picker offers this server, then every machine of the Project — reachable or not — and
  // any a table names; a deployment with none has one machine, and no picker. A machine that
  // drops out of reach keeps its place in the list, so the picker never leaves the header.
  const otherMachines = [
    ...new Set([
      ...machineLists.map((list) => list.machine.machineId),
      ...machineIds,
      ...(deployment?.plugins ?? []).flatMap((p) => p.machines ?? []),
    ]),
  ].filter((id) => id !== selfId);
  /** The machine the page shows and edits — undefined only until this server's id is read. */
  const viewMachine = viewedMachine(
    pickedMachine,
    [selfId ?? SELF_PENDING, ...otherMachines],
    selfId,
  );
  /**
   * The header's choices: this server first — standing in under {@link SELF_PENDING} until its id
   * is read, so the picker takes its place at once — then the other machines. One out of reach
   * says so in its entry; the one in view keeps its plain name, so the picker's own text and
   * width never move with a machine's link.
   */
  const machineChoices: MachineChoice[] = [
    { value: ALL_MACHINES, label: S.plugins.allMachines },
    { value: selfId ?? SELF_PENDING, label: S.plugins.thisServer },
    ...otherMachines.map((id) => ({
      value: id,
      label:
        id !== viewMachine && outOfReach(id) ? S.plugins.machineOutOfReach(nameOf(id)) : nameOf(id),
    })),
  ];
  /**
   * A machine picked in the header that is not one of the enrolled machines whose market is read
   * (one only a table names): what it runs is read through the proxy instead, and its rows are
   * the modules the Project's tables list for it. Its last answer stands while it is asked again.
   */
  const fallbackKey =
    projectId !== null &&
    !allMachines &&
    viewMachine !== undefined &&
    viewMachine !== selfId &&
    !machineMarkets.some((m) => m.machineId === viewMachine)
      ? installedPluginsKey(projectId, viewMachine)
      : null;
  const fallback = useRead(installedPlugins, fallbackKey, () =>
    api.getInstalledPlugins(projectId!, viewMachine!),
  );
  // A module that changed on this server, or on a machine, changes what that server's rows say:
  // its answer is read again (at once while it is in view).
  useOnPluginModulesChanged((server) => {
    if (projectId !== null) installedPlugins.invalidate(installedPluginsKey(projectId, server));
    if (server !== null) void machineMarkets.find((m) => m.machineId === server)?.rereadRunning();
  });
  /** Whether the machine in view is this server itself. */
  const viewingHere = viewMachine === selfId;
  /** This server's tables have not answered yet: every module row's status is a placeholder. */
  const tablesPending = deployment === null && deploymentRead.error === null;
  /**
   * A module row's state is not known yet: the tables have not answered, or the machine the row
   * is about has not said what it runs. Its status is a placeholder until then.
   */
  const modulesPendingFor = (row: PluginRow) =>
    tablesPending ||
    (row.origin !== undefined
      ? machineMarkets.find((m) => m.machineId === row.origin!.machineId)?.runningPending === true
      : fallbackKey !== null && fallback.value === null && fallback.error === null);

  /**
   * A server module change waiting for its confirmation (null = none). Applying one
   * re-assembles the App for every Project on the server; the runs in flight carry on, but it
   * changes what the whole server runs, so it is said before it is done.
   */
  const [pendingApply, setPendingApply] = useState<{
    specifier: string;
    name: string;
    install: boolean;
    /** The build ships it: the change enables or disables its module for this Project. */
    shipped: boolean;
    version?: string;
    release?: PackageUpdate | null;
    projectId: string;
    machineId: string;
  } | null>(null);

  /**
   * Installs the package into the data root (fetched from npm unless this build ships it) and
   * lists it for this Project, or removes it — through the store, so the change runs on while the
   * person moves between the market's pages (server-installs.ts). The server re-assembles the App
   * where it can, so the row's state afterwards is what the running process has — a load that
   * failed included, which is said as such rather than toasted as installed.
   */
  /**
   * Whether a module change still belongs to what the page shows: the same Project, and a machine
   * the view still holds. The write itself is this server's for every machine — it records the
   * change in the Project's tables and the fleet sync hands it on (market-rows.ts) — so a machine
   * out of reach does not hold it up.
   */
  const canApply = (target: { projectId: string; machineId: string }) =>
    target.projectId === projectId && (allMachines || target.machineId === viewMachine);
  const runDeploymentInstall = async (target: NonNullable<typeof pendingApply>) => {
    // A confirmation names the target that opened it, never a later picker or Project.
    setPendingApply(null);
    if (pendingSpecifier !== null || !canApply(target)) return;
    const market = machineMarkets.find((m) => m.machineId === target.machineId);
    await runServerChange(
      {
        projectId: target.projectId,
        machineId: target.machineId,
        specifier: target.specifier,
        install: target.install,
        title: target.name,
        ...(target.version !== undefined ? { version: target.version } : {}),
      },
      {
        selfId,
        rereadMachine:
          market !== undefined
            ? () => market.rereadRunning()
            : async () => {
                const machineKey = installedPluginsKey(target.projectId, target.machineId);
                installedPlugins.invalidate(machineKey);
                await installedPlugins
                  .read(machineKey, () =>
                    api.getInstalledPlugins(target.projectId, target.machineId),
                  )
                  .catch(() => undefined);
              },
        reloadAgents,
      },
    );
  };

  /**
   * From the server (admin): asks who would lose it first, for the confirm, then uninstalls it from
   * every Agent there and from the server itself (05 「插件库」 「安装模型」). `machineId` is the
   * card's machine (market-rows.ts `moduleTarget`): a machine is asked through this server's
   * tunnel, and its listing in this Project's table for that machine goes too, so the fleet sync
   * does not put it back.
   */
  const askServerUninstall = (specifier: string, name: string, machineId: string | undefined) => {
    if (projectId === null || machineId === undefined) return;
    const server = machineId === selfId ? null : machineId;
    setPendingServerUninstall({ specifier, name, machineId, holders: null, error: null });
    api.getPluginHolders(specifier, server).then(
      (holders) =>
        setPendingServerUninstall((p) =>
          p?.specifier === specifier && p.machineId === machineId ? { ...p, holders } : p,
        ),
      (e: unknown) =>
        setPendingServerUninstall((p) =>
          p?.specifier === specifier && p.machineId === machineId
            ? { ...p, error: apiErrorText(e) }
            : p,
        ),
    );
  };
  const runServerUninstall = async () => {
    const target = pendingServerUninstall;
    if (target === null || projectId === null) return;
    const server = target.machineId === selfId ? null : target.machineId;
    setServerUninstalling(true);
    try {
      if (server !== null) await api.uninstallPlugin(projectId, target.specifier, server);
      const done = await api.uninstallPluginFromServer(target.specifier, server);
      const failed = done.agents.flatMap((a) =>
        (a.failed ?? []).map((f) =>
          S.agentPlugins.failedPart(`${a.agentName} · ${f.name}`, f.error),
        ),
      );
      if (failed.length > 0) {
        toastError(
          S.plugins.installModel.uninstalledPartly(target.name, failed.join(S.todo.listSeparator)),
        );
      } else {
        toastSuccess(S.plugins.installModel.uninstalledToast(target.name, done.agents.length));
      }
      setPendingServerUninstall(null);
    } catch (e) {
      toastApiError(e);
    } finally {
      setServerUninstalling(false);
      // The server, its library and every Agent's installs moved.
      reloadServerPlugins();
      if (server !== null) {
        installedPlugins.invalidate(installedPluginsKey(projectId, server));
        // The machine's own library and running modules, which its cards show, moved too.
        machineMarkets.find((m) => m.machineId === server)?.refresh();
        reloadMachineAgents(server);
      } else void reloadAgents();
      for (const t of installsTargets) rereadInstalls(projectId, t.machineId, t.agentId);
    }
  };

  /**
   * The install flow's server step (plugin-install-flow.tsx), an admin's: the flow itself says what
   * installing on the server does, so it runs without a second confirm — the same install a
   * module's own confirm runs, the version a market entry names included (a shipped module is a
   * list edit, not a download). A machine's card lists it for that machine in this server's
   * tables (market-rows.ts `moduleTarget`), and the machine downloads it when the list arrives.
   */
  const installServer = (row: PluginRow) => {
    const machineId = moduleTarget(row, viewMachine);
    if (row.module === undefined || projectId === null || machineId === undefined) return;
    const release = row.module.shipped ? undefined : row.module.entry?.version;
    void runDeploymentInstall({
      specifier: row.module.specifier,
      name: rowTitle(row, locale),
      install: true,
      shipped: row.module.shipped,
      ...(release !== undefined ? { version: release } : {}),
      projectId,
      machineId,
    });
  };

  /**
   * A member's server step: asks an admin to install the package on the server, recorded with the
   * current Agent so the admin sees who asked and for which Agent.
   */
  const askAdmin = async (row: PluginRow) => {
    if (projectId === null || row.module === undefined) return;
    try {
      await api.askPluginPackage(projectId, row.module.specifier, currentAgent?.agentId ?? null);
      toastSuccess(S.plugins.installModel.requestedToast(row.name));
    } catch (e) {
      toastApiError(e);
      throw e;
    }
  };

  /**
   * What the server holds changed (an import, a delete): the library, the registry and the
   * Project's list are read again, each standing on screen until its answer lands.
   */
  const reloadServerPlugins = () => {
    if (projectId) notifyPluginsChanged(projectId);
    pluginLibrary.invalidate(LIBRARY_KEY);
    pluginIndex.invalidate(INDEX_KEY);
    if (deploymentKey !== null) installedPlugins.invalidate(deploymentKey);
  };

  /**
   * Every Agent a library plugin can be installed on: this server's and each machine's own, in
   * one list in the Agents page's order, keyed so that two servers' Agents of one id stay two
   * (lib/agent-location.ts). A machine out of reach keeps its Agents as it last listed them —
   * its rows held, its installs counted as last seen — so a machine that blinks changes no row
   * and no count. The system Agent takes no plugin and is never one of them.
   */
  const placed = mixAgents(agents, machineLists).filter((row) => isConversationAgent(row.agent));
  const targets: InstallTarget[] = placed.map(({ agent, on }) =>
    on === null
      ? { key: agent.agentId, agent, machine: null }
      : {
          key: agentKey(on.machine.machineId, agent.agentId),
          agent,
          machine: {
            machineId: on.machine.machineId,
            label: on.machine.label,
            live: on.live,
            reason: on.reason,
          },
        },
  );
  const installsTargets: InstallsTarget[] = placed.map(({ agent, on }) => ({
    key: on === null ? agent.agentId : agentKey(on.machine.machineId, agent.agentId),
    agentId: agent.agentId,
    machineId: on?.machine.machineId ?? null,
    readable: on === null || on.machine.link === "connected",
  }));
  // A machine that leaves the Project's list takes what was read from it along: its Agents'
  // installs and the modules it ran are forgotten, here and in storage. Only a list that has
  // answered counts: the empty one a Project switch passes through is not every machine leaving.
  const machinesState = useMachines().state;
  const listedMachines =
    machinesState === null ? null : machineLists.map((list) => list.machine.machineId).join(",");
  const lastListed = useRef<{ projectId: string; ids: string[] } | null>(null);
  useEffect(() => {
    if (projectId === null || listedMachines === null) return;
    const ids = listedMachines === "" ? [] : listedMachines.split(",");
    const before = lastListed.current;
    lastListed.current = { projectId, ids };
    if (before === null || before.projectId !== projectId) return;
    for (const gone of before.ids.filter((id) => !ids.includes(id))) {
      const prefix = readKey(projectId, gone);
      for (const key of agentInstalls.keys(prefix)) agentInstalls.forget(key);
      for (const key of installedPlugins.keys(prefix)) installedPlugins.forget(key);
    }
  }, [projectId, listedMachines]);
  const targetOf = (key: string) => targets.find((t) => t.key === key);
  /** The machine an install target lives on; null for this server. */
  const machineOfTarget = (key: string) => targetOf(key)?.machine?.machineId ?? null;
  /** A target's own Agent id: the key minus its machine. */
  const agentIdOf = (key: string) => targetOf(key)?.agent.agentId ?? key;
  /** After a change to one target: the list its counts and update marks are read from, again. */
  const reloadTargetAgents = (key: string) => {
    const machineId = machineOfTarget(key);
    if (machineId === null) void reloadAgents();
    else reloadMachineAgents(machineId);
  };

  // Installed skills, hook packages and MCP servers of every install target, each read on the
  // server it lives on and kept across visits (agent-installs.ts). An Agent not answered yet, or
  // whose read failed, is unknown — never "nothing installed" — and counts for nothing.
  const {
    installed: known,
    unknown,
    failed: unreadable,
  } = useAgentInstalls(projectId, installsTargets);
  /** What the page shows: the known installs, with a write in flight shown as it will be. */
  const installed: InstalledMap = useMemo(
    () => (writing.size === 0 ? known : new Map([...known, ...writing])),
    [known, writing],
  );
  /**
   * This server has not said yet what its own Agents hold: its Agent list is not in, or an
   * Agent of it has neither answered nor failed. Machines never hold this up.
   */
  const libraryPending =
    agentsLoading ||
    targets.some((t) => t.machine === null && unknown.has(t.key) && !unreadable.has(t.key));

  /**
   * A blank Agent was created from a card's install flow, on this server: its installs
   * are read first and the Agent list after, so its row joins the list already reading Installed.
   * A failed list read is said; the Agent exists either way.
   */
  const blankAgentCreated = async (agent: AgentSummary) => {
    if (!projectId) return;
    await readNewAgentInstalls(projectId, null, agent.agentId);
    try {
      await reloadAgents();
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Reads one target's lists again (Set up wrote its vault): what its MCP servers wait for moved. */
  const refreshAgentMcp = (key: string) => {
    if (!projectId) return;
    rereadInstalls(projectId, machineOfTarget(key), agentIdOf(key));
  };

  /**
   * One Agent's snapshot entry with a plugin marked present — each part at the library's own
   * version of it — or absent: its skills, its hook package when it ships one and its MCP
   * servers, all at once. A server marked present waits for nothing yet: the install's answer
   * says what it really waits for.
   */
  const withPlugin = (installs: AgentInstalls, plugin: PluginItem, on: boolean): AgentInstalls => {
    const skills = new Map(installs.skills);
    const hooks = new Map(installs.hooks);
    const mcp = new Map(installs.mcp);
    const workbenches = new Map(installs.workbenches);
    for (const w of plugin.workbenches ?? []) {
      if (on) workbenches.set(w.name, { plugin: plugin.name, version: w.version });
      else if (workbenches.get(w.name)?.plugin === plugin.name) workbenches.delete(w.name);
    }
    for (const skill of plugin.skills) {
      if (on) skills.set(skill.name, skill.version);
      else skills.delete(skill.name);
    }
    if (plugin.hooks.length > 0) {
      if (on) hooks.set(plugin.name, plugin.hookVersion ?? "");
      else hooks.delete(plugin.name);
    }
    for (const server of plugin.mcpServers) {
      if (on) {
        mcp.set(server.name, {
          name: server.name,
          transport: server.transport,
          target: server.target,
          plugin: plugin.name,
          missingKeys: [],
          signIn: server.signIn,
        });
      } else if (mcp.get(server.name)?.plugin === plugin.name) mcp.delete(server.name);
    }
    return { skills, hooks, mcp, workbenches };
  };

  /**
   * Install (any member) / uninstall (the Project owner) on one Agent: optimistic update, a
   * confirmation toast on success, rollback plus a toast on failure — a server name the Agent
   * already has from someone else is the server's refusal, named in the toast. Each is one
   * request for the whole plugin; an uninstall that could not remove some part still removed the
   * rest, and names what it left with why. The Agent list is re-read afterwards either way: the
   * card's counts and its `pluginUpdates` moved, and both are read off that list.
   */
  const toggleInstall = async (key: string, plugin: PluginItem, on: boolean) => {
    if (!projectId) return false;
    const prev = installed.get(key) ?? NO_INSTALLS;
    const target = targetOf(key);
    if (!target || target.machine?.live === false) return false;
    const agentId = agentIdOf(key);
    /** Every part goes to the server the Agent lives on. */
    const machineId = machineOfTarget(key);
    const where = { projectId, agentId, machineId };
    // Shown as it will be while the write runs; dropped once the answer is in the store (or
    // the write failed, which leaves the store as it was).
    const optimistic = withPlugin(prev, plugin, on);
    setWriting((m) => new Map(m).set(key, optimistic));
    const written = () =>
      setWriting((m) => {
        if (m.get(key) !== optimistic) return m;
        const next = new Map(m);
        next.delete(key);
        return next;
      });
    // A machine's Agent is named with its machine, as the dialog lists it.
    const agentName =
      target === undefined
        ? agentId
        : target.machine === null
          ? agentDisplayName(target.agent)
          : `${agentDisplayName(target.agent)} ${S.chat.machineTag(target.machine.label)}`;
    try {
      if (on) {
        const done = await installOnAgent(where, [plugin.name]);
        toastInstall(
          `${S.plugins.installedToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
          plugin.name,
          done.modules,
          target?.machine?.label,
        );
      } else {
        // One request: the server takes every part apart. "Nothing of it is here" is the state
        // asked for (this page's snapshot was behind), so it does not fail the uninstall —
        // otherwise the row would be stuck at "Installed".
        const outcome = await uninstallFromAgent(where, plugin.name, plugin);
        const failed = outcome.kind === "removed" ? outcome.failed : [];
        if (failed.length > 0) {
          const named = failed.map((f) => S.agentPlugins.failedPart(f.name, f.error));
          toastFailure(
            toldFailure(
              S.agentPlugins.uninstallPartly(plugin.name, named.join(S.todo.listSeparator)),
              {
                what: "a plugin's parts could not all be removed",
                facts: [["Plugin", plugin.name]],
                detail: failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
              },
            ),
          );
        } else {
          toastSuccess(
            `${S.plugins.uninstalledToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
          );
        }
      }
    } catch (e) {
      written();
      // A 404 of any other kind is a server without the request: a machine older than this page.
      toastWriteError(e, machineId);
      return false;
    }
    written();
    reloadTargetAgents(key);
    return true;
  };

  /**
   * Update reminder action: reinstall the current library copy on every outdated Agent
   * (install-again-is-update semantics). One success toast for the whole batch; on partial
   * failure the succeeded Agents keep their calibrated state and the first error is toasted.
   */
  const updateOutdated = async (name: string, keys: string[]) => {
    if (!projectId || keys.length === 0) return;
    const results = await Promise.allSettled(
      keys.map((key) =>
        installOnAgent({ projectId, agentId: agentIdOf(key), machineId: machineOfTarget(key) }, [
          name,
        ]),
      ),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!failed) toastSuccess(S.plugins.updatedToast(name, keys.length));
    else toastApiError(failed.reason);
    // The outdated marks and the nav badge are both read off `AgentSummary.pluginUpdates`,
    // which this page's install map does not feed: without reloading the Agent list the dot
    // would survive the very update it led the user to. Runs after a partial failure too —
    // some Agent moved. A machine's Agents are read from that machine again.
    for (const machineId of new Set(keys.map(machineOfTarget))) {
      if (machineId === null) void reloadAgents();
      else reloadMachineAgents(machineId);
    }
  };

  /**
   * The notice's bulk action: reinstall the library copy of every outdated plugin, on every
   * Agent behind on it — the per-card update, over the whole page. The per-card and per-Agent
   * controls are untouched and remain the way to update just one.
   *
   * `Promise.allSettled` over one request per Agent, the shape the per-plugin update already
   * uses, and the same reload afterwards: the gate reads `AgentSummary.pluginUpdates`, which
   * this page's install map does not feed, so without it the dot would survive the very update
   * it led the user to. What is new is that a partial failure NAMES the Agents that did not take
   * it — on a control whose whole point is "all of them at once", a first-error toast leaves the
   * user unable to tell which half they are looking at.
   */
  const runBulkUpdate = async (plan: PluginUpdatePlan) => {
    if (!projectId || plan.perAgent.length === 0) return;
    setBulkRunning(true);
    const labels = plan.perAgent.map(({ agentId }) => {
      const agent = agents.find((a) => a.agentId === agentId);
      return agent ? agentDisplayName(agent) : agentId;
    });
    const results = await Promise.allSettled(
      // The plan is built from this server's Agents, as the update badge counts them.
      plan.perAgent.map(({ agentId, names }) =>
        installOnAgent({ projectId, agentId, machineId: null }, names),
      ),
    );
    const outcome = bulkOutcome(labels, results);
    if (outcome.allOk) toastSuccess(S.todo.bulkDone(outcome.ok));
    else {
      const failure = firstFailure(results);
      toastApiError(failure, {
        text: `${S.todo.bulkPartial(outcome.ok, failedList(outcome.failed, S.todo.listSeparator))} — ${apiErrorText(failure)}`,
      });
    }
    // Runs after a partial failure too — some Agent moved, and the gate has to see it. Guarded,
    // because `reloadAgents` rejects on a failed list read and the busy flag disables every
    // control here, the dialog's Cancel included: a reload that failed after the writes landed
    // would otherwise leave the page frozen with nothing saying why.
    try {
      await reloadAgents();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBulkRunning(false);
    }
  };

  /**
   * Quick start: a plugin's demo, opened as a new-chat draft on the currently selected Agent —
   * written, never sent, so nothing runs (and no token is spent) until the person sends it. The
   * prompt goes in per UI language, overwriting the draft body (any typed-but-unsent text is
   * parked as a draft conversation first, draft-sessions.ts), with the demo's skills
   * pre-selected, goal mode on when the demo is a goal, and the plugin's composer switch on when
   * it has one. handoffAgentId must be cleared: a leftover handoff target would forward the demo
   * to a different Agent.
   */
  const openQuickStart = (
    quickStart: QuickStartItem,
    plugin: PluginItem,
    target: InstallTarget,
  ) => {
    const agentId = target.agent.agentId;
    const place = target.machine ? { machineId: target.machine.machineId, workspace: "" } : {};
    if (!agentId) return;
    if (userId && projectId) {
      // Typed-but-unsent draft text becomes a parked draft conversation instead of being
      // clobbered by the canned invocation body, and the Workspace and approval mode start on
      // the Project's new-chat defaults (new-chat.ts).
      prepareNewChatDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      const { skills: _skills, goal: _goal, promptHooks: _promptHooks, ...rest } = loadDraft(key);
      saveDraft(key, {
        ...rest,
        ...place,
        agentId,
        text: localizedText(locale, quickStart.prompt, quickStart.promptZh),
        ...(quickStart.skills !== undefined && quickStart.skills.length > 0
          ? { skills: quickStart.skills }
          : {}),
        ...(quickStart.goal === true ? { goal: true as const } : {}),
        ...(plugin.composerMode === true && quickStart.goal !== true
          ? { promptHooks: [plugin.name] }
          : {}),
        handoffAgentId: undefined,
      });
    }
    if (!target.machine) setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId, ...place } });
  };

  /** A library plugin waiting for "install on this Agent, then quick start" to be confirmed. */
  const [pendingQuickStart, setPendingQuickStart] = useState<{
    plugin: PluginItem;
    key: string;
    projectId: string | null;
  } | null>(null);
  const [quickStartInstalling, setQuickStartInstalling] = useState(false);

  /** A library plugin's quick start: on an Agent that has all of it, it opens; otherwise installing comes first, and is asked. */
  const quickStartLibrary = (plugin: PluginItem, target: InstallTarget | undefined) => {
    const demo = libraryQuickStart(plugin);
    if (demo === null || !target || target.machine?.live === false) return;
    if (pluginComplete(plugin, installed.get(target.key))) openQuickStart(demo, plugin, target);
    else setPendingQuickStart({ plugin, key: target.key, projectId });
  };

  const quickTarget =
    pendingQuickStart?.projectId === projectId && pendingQuickStart
      ? targetOf(pendingQuickStart.key)
      : undefined;
  const confirmQuickStartInstall = async () => {
    if (!pendingQuickStart || !quickTarget || quickTarget.machine?.live === false) return;
    const { plugin } = pendingQuickStart;
    setQuickStartInstalling(true);
    const ok = await toggleInstall(quickTarget.key, plugin, true);
    setQuickStartInstalling(false);
    setPendingQuickStart(null);
    const demo = libraryQuickStart(plugin);
    if (ok && demo !== null && isCurrentVisit()) openQuickStart(demo, plugin, quickTarget);
  };

  // The rows for the header's choice, and where each one's actions go (market-rows.ts).
  const here = { groups: groups ?? [], tables: deployment, index: index ?? [] };
  const view = allMachines
    ? ({ all: true } as const)
    : ({ all: false, machineId: viewMachine } as const);
  const rows: PluginRow[] = marketRows(view, here, machineMarkets, fallback.value);
  const categories = pluginCategories(
    [...(groups ?? []), ...machineMarkets.flatMap((m) => m.library ?? [])],
    locale,
  );
  const targetsFor = (row: PluginRow) => rowTargets(row, targets);
  const usages = new Map<string, LibraryUsage>();
  for (const row of rows) {
    if (row.library !== undefined) {
      usages.set(
        row.key,
        libraryUsage(
          row.library,
          targetsFor(row).map((t) => ({
            agentId: t.key,
            pluginUpdates: t.agent.pluginUpdates,
            lastSeen: t.machine !== null && t.machine.live === false,
          })),
          installed,
        ),
      );
    }
  }
  /** How the library's server modules stand on the server a row comes from: its own answer says. */
  const moduleStatesOf = (row: PluginRow) =>
    (row.origin === undefined
      ? deployment
      : (machineMarkets.find((m) => m.machineId === row.origin!.machineId)?.running ?? null)
    )?.modules ?? [];
  const statusOf = (row: PluginRow): PluginStatus =>
    pluginStatus(
      row,
      usages.get(row.key) ?? null,
      row.library?.modules === true
        ? moduleStatesOf(row).find((m) => m.plugin === row.library!.name)
        : undefined,
    );
  const unsatisfiedCount = rows.filter((row) => row.module?.unsatisfied !== undefined).length;
  const categoryTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? id;
  /**
   * The row a plugin's page names: with a machine, that machine's row of the name; a machine no
   * longer listed, or one that has no such row, falls back to this server's (and, in "All
   * machines", to the first row of that name).
   */
  const rowNamed = (name: string, machine: string | null): PluginRow | undefined => {
    const market = machineMarkets.find((m) => m.machineId === machine);
    return (
      (market === undefined
        ? undefined
        : marketRows({ all: false, machineId: market.machineId }, here, machineMarkets, null).find(
            (row) => row.name === name,
          )) ??
      rows.find((row) => row.name === name && row.origin === undefined) ??
      rows.find((row) => row.name === name)
    );
  };

  /** The address of a row's page: its name, and its machine for a machine's card. */
  const pageOf = (row: PluginRow) =>
    `${PLUGINS_PATH}/${encodeURIComponent(row.name)}${
      row.origin === undefined ? "" : `?${new URLSearchParams({ machine: row.origin.machineId })}`
    }`;

  /**
   * A card's (or a page's) props for one row: `showCategory` says whether its facts name its
   * category (not inside the category's own section, whose head names it).
   */
  const cardProps = (row: PluginRow, { showCategory = true } = {}): PluginCardProps => {
    const choices = targetsFor(row);
    const current = rowCurrentTarget(row, choices, currentAgent?.agentId, (t) =>
      row.library === undefined ? false : pluginComplete(row.library, installed.get(t.key)),
    );
    /** The machine a module change of this row is listed for, in this server's tables. */
    const rowMachine = moduleTarget(row, viewMachine);
    const live = row.origin?.live !== false;
    const ownPackage = offersPackageUpdate(row);
    /** This row's server change, when its package's is running or failed on its machine. */
    const run =
      row.module !== undefined && rowMachine !== undefined && projectId !== null
        ? (runs[runKey(projectId, rowMachine, row.module.specifier)] ?? null)
        : null;
    const href = pageOf(row);
    return {
      currentAgentId: current?.key,
      href,
      onOpen: (event) => {
        // A press with a modifier opens the page as the browser would (a new tab, a window).
        if (pressOpensElsewhere(event)) return;
        event.preventDefault();
        void navigate(href, { state: { fromMarket: true } });
      },
      art: artOf(market, row),
      selected: isSelected(market, row),
      onOpenApp: (appId) => void navigate(appWindowPath(appId)),
      row,
      status: statusOf(row),
      usage: usages.get(row.key) ?? null,
      categoryTitle: categoryTitle(row.category),
      showCategory,
      targets: live
        ? choices
        : choices.map((t) => (t.machine ? { ...t, machine: { ...t.machine, live: false } } : t)),
      blankAgent: { library: pickLibrary, onCreated: blankAgentCreated },
      installed,
      unknown,
      failed: unreadable,
      pending:
        (row.module !== undefined && modulesPendingFor(row)) ||
        (row.library !== undefined && libraryPending),
      canQuickStart: live && !!current,
      isAdmin,
      isOwner,
      projectId,
      busy: run?.phase === "running",
      progress: run?.phase === "running" ? run.progress : null,
      stage: run?.phase === "running" ? run.stage : null,
      failure: run?.phase === "failed" ? run.failure : null,
      remoteInstall: rowMachine !== undefined && selfId !== undefined && rowMachine !== selfId,
      onDismissFailure: () => {
        if (run !== null) dismissServerFailure(run.projectId, run.machineId, run.specifier);
      },
      onOpenSources: () => setSettingsOpen(true),
      onImportFile: () => setImportOpen(true),
      onInstallServer: () => installServer(row),
      onAskAdmin: () => askAdmin(row),
      ...(isAdmin && rowMachine !== undefined && live
        ? {
            onServerUninstall: () =>
              askServerUninstall(
                row.module?.specifier ?? row.library?.package ?? row.name,
                row.name,
                rowMachine,
              ),
          }
        : {}),
      blocked: rowBlocked(
        row,
        viewMachine,
        pendingSpecifier ??
          (serverUninstalling ? (pendingServerUninstall?.specifier ?? null) : null),
      ),
      onQuickStart: (plugin) => quickStartLibrary(plugin, current),
      onToggleInstall: toggleInstall,
      onUpdateOutdated: updateOutdated,
      // The update offer reads this server's own install, so only this server's cards make it.
      showPackageUpdates: ownPackage && (allMachines || viewingHere),
      onModuleApply: (install, version) => {
        if (row.module !== undefined && projectId !== null && rowMachine !== undefined) {
          setPendingApply({
            specifier: row.module.specifier,
            name: rowTitle(row, locale),
            install,
            shipped: row.module.shipped,
            version,
            ...(ownPackage && version ? { release: packageUpdate(row.module.entry) } : {}),
            projectId,
            machineId: rowMachine,
          });
        }
      },
      onRepair:
        isAdmin && !row.origin && row.module?.unsatisfied !== undefined
          ? () =>
              repair({
                specifier: row.module!.specifier,
                disabled: row.module!.state === "disabled",
                reason: row.module!.unsatisfied!,
              })
          : null,
      onMcpChanged: refreshAgentMcp,
    };
  };

  /** What every page of the market mounts beside its own content: its confirmations and dialogs. */
  const dialogs = (
    <>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        section={settingsSection}
      />
      {isAdmin && projectId !== null && (
        <ImportPluginModal
          open={importOpen}
          projectId={projectId}
          agentId={pickDefaultAgent(agents)?.agentId ?? null}
          onClose={() => setImportOpen(false)}
          onInstalled={reloadServerPlugins}
        />
      )}
      {/* A server module change: what it does is said before it runs, and what it costs in
          small type under it. An install is primary; a removal is danger. */}
      {pendingApply?.release && canApply(pendingApply) && isAdmin && (
        <PackageUpdateDialog
          projectId={pendingApply.projectId}
          title={pendingApply.name}
          release={pendingApply.release}
          onClose={() => setPendingApply(null)}
          onUpdated={() => void reloadAgents().catch(() => undefined)}
        />
      )}
      {pendingApply !== null && !pendingApply.release && canApply(pendingApply) && (
        <ConfirmModal
          open
          title={
            pendingApply.shipped
              ? pendingApply.install
                ? S.plugins.installModel.enableTitle(pendingApply.name)
                : S.plugins.installModel.disableTitle(pendingApply.name)
              : pendingApply.install
                ? S.plugins.applyConfirmInstall(pendingApply.name)
                : S.plugins.applyConfirmRemove(pendingApply.name)
          }
          tone={pendingApply.install ? "primary" : "danger"}
          {...(pendingApply.install ? { glyph: ICONS.server } : {})}
          confirmLabel={
            pendingApply.shipped
              ? pendingApply.install
                ? S.plugins.installModel.enableModule
                : S.plugins.installModel.disableModule
              : pendingApply.install
                ? S.plugins.installModel.installServer
                : S.plugins.uninstall
          }
          cancelLabel={S.common.cancel}
          busy={pendingSpecifier !== null}
          onClose={() => setPendingApply(null)}
          onConfirm={() => void runDeploymentInstall(pendingApply)}
        >
          <ModuleApplyBody
            mode={
              pendingApply.shipped
                ? pendingApply.install
                  ? "enable"
                  : "disable"
                : pendingApply.install
                  ? "install"
                  : "remove"
            }
            name={
              pendingApply.version
                ? `${pendingApply.name} v${pendingApply.version}`
                : pendingApply.name
            }
          />
        </ConfirmModal>
      )}
      {/* From the server: it leaves every Agent first, which the confirm names before it runs. */}
      {pendingServerUninstall !== null && (
        <ConfirmModal
          open
          title={S.plugins.installModel.uninstallTitle(pendingServerUninstall.name)}
          tone="danger"
          confirmLabel={S.plugins.installModel.uninstallServer}
          cancelLabel={S.common.cancel}
          busy={serverUninstalling}
          confirmDisabled={
            pendingServerUninstall.holders === null ||
            pendingServerUninstall.holders.shipped ||
            pendingServerUninstall.holders.shared.length > 0
          }
          onClose={() => setPendingServerUninstall(null)}
          onConfirm={() => void runServerUninstall()}
        >
          <ServerUninstallBody
            target={pendingServerUninstall}
            retry={() =>
              askServerUninstall(
                pendingServerUninstall.specifier,
                pendingServerUninstall.name,
                pendingServerUninstall.machineId,
              )
            }
          />
        </ConfirmModal>
      )}
      {repairModal}
      {/* A library plugin's quick start on an Agent that lacks it: installing comes first, and is asked. */}
      {pendingQuickStart !== null && quickTarget && quickTarget.machine?.live !== false && (
        <ConfirmModal
          open
          title={S.plugins.quickStartInstallTitle(
            pendingQuickStart.plugin.name,
            [agentDisplayName(quickTarget.agent), quickTarget.machine?.label]
              .filter(Boolean)
              .join(" · "),
          )}
          tone="primary"
          confirmLabel={S.plugins.install}
          cancelLabel={S.common.cancel}
          busy={quickStartInstalling}
          onClose={() => setPendingQuickStart(null)}
          onConfirm={() => void confirmQuickStartInstall()}
        >
          <p>{S.plugins.quickStartAfterInstall}</p>
          {/* The install brings a stdio server: the command it runs here is said before it does. */}
          {installNeedsConfirm(pendingQuickStart.plugin, installed.get(quickTarget.key)) && (
            <div className="mt-3">
              <StdioInstallBody plugin={pendingQuickStart.plugin} />
            </div>
          )}
        </ConfirmModal>
      )}
    </>
  );

  return {
    navigate,
    locale,
    projectId,
    agents,
    isAdmin,
    todo,
    bulkRunning,
    runBulkUpdate,
    dismissTodo: () => {
      if (todo !== undefined) dismissTodo(projectId, "plugins", todo.signature);
    },
    library,
    groups,
    error,
    registry,
    index,
    indexFailures,
    indexPending,
    market,
    offlineMarkets,
    fallbackKey,
    fallback,
    viewMachine,
    viewingHere,
    deployment,
    allMachines,
    otherMachines,
    machineChoices,
    nameOf,
    setPickedMachine,
    moduleRequests,
    openSettings: (section: "plugins" | "moduleRequests") => {
      setSettingsSection(section);
      setSettingsOpen(true);
    },
    openImport: () => setImportOpen(true),
    rows,
    categories,
    categoryTitle,
    statusOf,
    usages,
    unsatisfiedCount,
    rowNamed,
    pageOf,
    cardProps,
    dialogs,
  };
}

/**
 * The server-uninstall confirm's body: how many Agents lose the plugin and which (named up to five,
 * the rest counted), and that their copies go with it — or why it cannot run (a Project's shared
 * table lists it). While the holders are being asked for, a line says so and the button waits.
 */
function ServerUninstallBody({
  target,
  retry,
}: {
  retry: () => void;
  target: {
    name: string;
    holders: PluginHoldersResponse | null;
    error: string | null;
  };
}) {
  const words = S.plugins.installModel;
  const holders = target.holders;
  if (target.error !== null) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm">
          {target.error}
        </p>
        <Button size="sm" onClick={retry}>
          {S.common.retry}
        </Button>
      </div>
    );
  }
  if (holders?.shipped) return <p className="text-sm">{S.plugins.libraryBuiltinHint}</p>;
  if (holders !== null && holders.shared.length > 0) {
    return (
      <p className="text-sm">
        {words.sharedRefused(holders.shared.map((p) => p.projectName).join(S.todo.listSeparator))}
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {holders !== null && <p>{words.uninstallBody(target.name, holders.agents.length)}</p>}
      <ImpactList
        items={
          holders === null
            ? null
            : holders.agents.map((a) => ({
                key: `${a.projectId}/${a.agentId}`,
                name: a.agentName,
                where: a.projectName,
              }))
        }
        more={words.moreAgents}
        pending={words.holdersLoading}
      />
      {holders !== null && holders.agents.length > 0 && (
        <p className="text-xs text-fg-muted">{words.uninstallCopies}</p>
      )}
    </div>
  );
}
