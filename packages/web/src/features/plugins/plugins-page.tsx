/**
 * The plugin market: every plugin as one cover card (plugin-card.tsx) — the library's plugins
 * (Skills and/or a hook package, loaded by core from the @penguinharness/* packages and
 * installed on Agents) and the server modules a Project can ask for (the Agent Sandbox backends
 * and whatever the registry lists, installed on the server by an admin). The catalogue opens
 * directly on the search, filters and results. Cards and compact rows share their actions.
 * - **The tabs**: "All", then one tab per section of the grouping (category unless the reader
 *   picks status or contents; no grouping, no tabs). The tab is in the URL (`?tab=<section>`),
 *   so a tab can be linked; one the grouping does not have reads as All. The grouping select and
 *   the sort select stand at the tab row's end; both are remembered per browser
 *   (plugin-groups.ts, plugin-market.ts), the search is not.
 * - **The grid** is the tab's rows, narrowed by the search, in the chosen sort — the curation's
 *   order, recency, use in this Project, the name, or installs while the curation carries
 *   live popularity figures. A search that finds nothing here but something in another tab says so
 *   and offers the "All" tab.
 * - **The detail** is in the URL too (`?plugin=<name>`): opening one pushes a history entry, so
 *   Back closes it; closing one a link opened replaces the entry. The plugin a link names shows
 *   its detail even while the tab or the search hides its card.
 *
 * A notice counts the plugins this build cannot fully run. The status rules are in plugin-status.ts.
 *
 * - A library plugin is installed per Agent, by any member, through its card's "manage
 *   installs" dialog, and uninstalled there by the Project owner; the update nudge appears when
 *   the server lists some Agent's copy as behind (`AgentSummary.pluginUpdates` — the page never
 *   compares versions itself), and the notice under the title updates every outdated plugin at
 *   once. Installed means the whole plugin: every one of its skills in the Agent's installed
 *   skills, its hook package (when it ships one) in the Agent's installed hooks, and each of its
 *   MCP servers among the Agent's servers as an entry it installed — which is why the page reads
 *   the three lists per Agent (agent-installs.ts). Uninstall is one request, which the server
 *   carries out part by part. The dialog lists this server's Agents and each machine's
 *   own in one list, in the Agents page's order (lib/machine-agent-lists.ts `mixAgents`): a
 *   machine's Agent is installed on, read back from and updated on that machine, from that
 *   machine's library, and counts towards the card's "used by" and status — with what the
 *   machine last answered while it is out of reach. The update notice and the nav badge it
 *   answers are this server's alone.
 * - A server module is installed on the whole server for every Project, by an admin only (a
 *   member sees the card read-only). Installing or removing one re-assembles the App, which stops
 *   the agent runs in progress in every Project, so the confirm says what the install does and,
 *   in small type below, what it costs.
 * - **Machines**: for an administrator of a Project with machines, the header's machine picker
 *   opens on "All machines" — this server's cards, then each machine's card that says something
 *   this server's does not, named after its machine — and narrows to this server or one machine.
 *   Every machine is read (machine-markets.ts); a server module is written only through this
 *   server's Project tables, which the fleet sync hands to the machine, and an Agent's plugin on
 *   the Agent's own server (market-rows.ts). A machine out of reach keeps its cards, and a note
 *   under the title names it.
 *
 * Every read the page makes keeps its last answer (lib/read-store.ts): coming back to the page
 * shows what it showed, an answer is read again behind it, and a status, a count or a row's state
 * changes only when an answer says something different — never because a read is in flight,
 * failed, or a machine dropped out of reach. Until this server has answered at least once, the
 * card's status and "used by" are placeholders (plugin-card.tsx).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import type {
  AgentSummary,
  PluginHoldersResponse,
  PluginItem,
  QuickStartItem,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  CoverCardSkeleton,
  ImpactList,
  GlyphIcon,
  ICONS,
  Notice,
  PageFrame,
  PageHeader,
  SearchInput,
  Select,
  ShowcaseGrid,
  ShowcaseLayoutToggle,
  useShowcaseLayout,
  Tabs,
  Waiting,
  TodoNotice,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { isConversationAgent } from "../../lib/builtin-agents";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  useUpdateBadges,
  dismissTodo,
  bulkOutcome,
  failedList,
  firstFailure,
  noticeCounts,
} from "../todos";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useMachines } from "../../state/machines";
import { useSessions } from "../../state/sessions";
import { agentKey } from "../../lib/agent-location";
import { mixAgents, useMachineAgents } from "../../lib/machine-agent-lists";
import { readKey, useRead } from "../../lib/read-store";
import { MachinePicker, type MachineChoice } from "../machines";
import { DRAFT_SESSION_ID, draftKey, loadDraft, prepareNewChatDraft, saveDraft } from "@prismshadow/penguin-library-session/web";
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
import { toneInk } from "../../lib/tone";
import { appWindowPath } from "../../lib/app-center-path";
import { ModuleApplyBody, PluginCard, libraryQuickStart } from "./plugin-card";
import type { InstallTarget, PluginCardProps } from "./plugin-card";
import type { InstallFailure } from "./plugin-install-flow";
import { rowTitle } from "./plugin-marks";
import {
  ALL_TAB,
  artOf,
  availableSorts,
  initialPluginsSort,
  isSelected,
  popularityOf,
  sortRows,
  storePluginsSort,
  tabRows,
  type PluginSort,
} from "./plugin-market";
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
import { StdioDisclosure, StdioInstallBody } from "./plugin-mcp";
import { SourceFailuresNotice } from "./source-failures-notice";
import { ImportPluginModal } from "./plugin-import-modal";
import {
  PLUGIN_GROUP_BYS,
  groupRows,
  initialPluginsGroupBy,
  pluginCategories,
  storePluginsGroupBy,
  type PluginGroupBy,
  type PluginRow,
} from "./plugin-groups";
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
import { failureOf, toldFailure } from "../../lib/failure";

const NO_INSTALLS: AgentInstalls = { skills: new Map(), hooks: new Map(), mcp: new Map() };

export { INDEX_RECHECK_MS } from "./plugin-reads";

/** This server's reads are read again on every visit, however recent the last answer. */
const EVERY_VISIT = { minAgeMs: 0 };

/** The picker's value for this server until its id is read: no machine id is empty. */
const SELF_PENDING = "";
/** The picker's value for every machine at once; no machine id is `*`. */
const ALL_MACHINES = "*";

/**
 * The query naming the tab on show (absent: All), the plugin whose detail is open, and — for a
 * machine's card — the machine it came from (a stale one falls back to this server's card).
 */
const TAB_PARAM = "tab";
const PLUGIN_PARAM = "plugin";
const DETAIL_MACHINE_PARAM = "machine";

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

export function PluginsPage() {
  useDocumentTitle(S.nav.plugins);
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
  /** The bulk update's confirmation is open (null = closed); it holds the plan it will run. */
  const [pendingBulk, setPendingBulk] = useState<PluginUpdatePlan | null>(null);
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
  /** The specifier whose install or removal is running: the list is written one verb at a time. */
  const [pendingSpecifier, setPendingSpecifier] = useState<string | null>(null);
  /**
   * The channel download under that install: which specifier it is for and how far the bytes
   * have come. npm's own installs answer no progress, so they leave this null.
   */
  const [installProgress, setInstallProgress] = useState<{
    specifier: string;
    received: number;
    total: number | null;
  } | null>(null);
  /** The step that install has reached, as its stream says: the source tried, or the re-assembly. */
  const [installStage, setInstallStage] = useState<{
    specifier: string;
    stage: api.InstallStage;
  } | null>(null);
  /** The last server install that failed, per specifier: said under its card with the next steps. */
  const [installFailures, setInstallFailures] = useState<ReadonlyMap<string, InstallFailure>>(
    new Map(),
  );
  const failInstall = (specifier: string, why: InstallFailure | null) =>
    setInstallFailures((m) => {
      const next = new Map(m);
      if (why === null) next.delete(specifier);
      else next.set(specifier, why);
      return next;
    });
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
  /** Free text over names, descriptions and keywords. */
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<PluginGroupBy>(() => initialPluginsGroupBy());
  const [layout, chooseLayout] = useShowcaseLayout("penguin.pluginsLayout");
  const [sort, setSort] = useState<PluginSort>(() => initialPluginsSort());

  const chooseGroupBy = (by: PluginGroupBy) => {
    setGroupBy(by);
    storePluginsGroupBy(by);
  };
  const chooseSort = (next: PluginSort) => {
    setSort(next);
    storePluginsSort(next);
  };

  /**
   * The curation: what is selected, what may lead, and the art; null until it answers, and for
   * good when it cannot (a server older than the market answers 404) — generated covers.
   */
  const market = useRead(pluginMarket, MARKET_KEY, () => api.getPluginMarket(), EVERY_VISIT).value;

  // The tab and the open detail live in the URL. A tab switch replaces the entry; a detail
  // opened here pushes one, so Back closes it, and closing it steps back; closing one a link
  // opened replaces the entry instead.
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get(TAB_PARAM);
  const openName = params.get(PLUGIN_PARAM);
  const openedHere = (location.state as { pluginDetail?: boolean } | null)?.pluginDetail === true;
  const withParam = (name: string, value: string | null) => (prev: URLSearchParams) => {
    const next = new URLSearchParams(prev);
    if (value === null) next.delete(name);
    else next.set(name, value);
    return next;
  };
  const selectTab = (key: string) =>
    setParams(withParam(TAB_PARAM, key === ALL_TAB ? null : key), { replace: true });
  /** A machine's card opens its detail with the machine named beside the plugin. */
  const openDetail = (row: PluginRow) =>
    setParams(
      (prev) =>
        withParam(
          DETAIL_MACHINE_PARAM,
          row.origin?.machineId ?? null,
        )(withParam(PLUGIN_PARAM, row.name)(prev)),
      { state: { pluginDetail: true } },
    );
  const closeDetail = () => {
    if (openedHere) void navigate(-1);
    else
      setParams(
        (prev) => withParam(DETAIL_MACHINE_PARAM, null)(withParam(PLUGIN_PARAM, null)(prev)),
        { replace: true },
      );
  };

  const { machineIds, machineLabels } = useSessions();
  /** Every machine of the Project with its Agents, reachable or not (lib/machine-agent-lists.ts). */
  const { lists: machineLists, reload: reloadMachineAgents } = useMachineAgents(projectId);
  /** The machine picked in the header; null shows every machine's cards ("All machines"). */
  const [pickedMachine, setPickedMachine] = useState<string | null>(null);
  /** Installs written on an Agent and not answered yet, by target key: what the dialog shows meanwhile. */
  const [writing, setWriting] = useState<ReadonlyMap<string, AgentInstalls>>(() => new Map());
  useEffect(() => {
    setPickedMachine(null);
    setPendingSpecifier(null);
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
   * lists it for this Project — writing the list alone would name a package that is not on
   * the machine, which is exactly the state the row would then have to report as broken. The
   * server re-assembles the App where it can, so the row's state afterwards is what the
   * running process has — including a load that failed, which is reported as such rather than
   * toasted as installed; otherwise the row waits for a restart.
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
    if (pendingSpecifier !== null) return;
    if (!canApply(target)) {
      setPendingApply(null);
      return;
    }
    const { specifier, install } = target;
    setPendingSpecifier(specifier);
    if (install) failInstall(specifier, null);
    // The server's last report, kept for a failure to say where the install stopped.
    let lastStage: api.InstallStage | null = null;
    let lastProgress: { received: number; total: number | null } | null = null;
    try {
      const next = install
        ? await api.installPluginStream(
            target.projectId,
            target.version ? `${specifier}@${target.version}` : specifier,
            target.machineId,
            // A download the user has navigated away from does not write this visit's state;
            // the request itself runs on.
            (received, total) => {
              lastProgress = { received, total };
              if (isCurrentVisit()) setInstallProgress({ specifier, received, total });
            },
            (stage) => {
              lastStage = stage;
              lastProgress = null;
              if (!isCurrentVisit()) return;
              setInstallStage({ specifier, stage });
              // A download belongs to one source: the next step's words replace its percent.
              setInstallProgress(null);
            },
          )
        : await api.uninstallPlugin(target.projectId, specifier, target.machineId);
      notifyPluginsChanged(target.projectId);
      // A write that answers in a later visit is not taken: that visit read the list itself.
      if (!isCurrentVisit()) return;
      if (target.machineId !== selfId) {
        // The machine is handed its part in the background: its row keeps the state it has until
        // the machine is asked again, then shows what the machine reports — the tables' new
        // answer is taken together with the machine's, never ahead of it. A machine that cannot
        // answer keeps its last answer; the tables' answer is taken anyway.
        const market = machineMarkets.find((m) => m.machineId === target.machineId);
        if (market !== undefined) await market.rereadRunning();
        else {
          const machineKey = installedPluginsKey(target.projectId, target.machineId);
          installedPlugins.invalidate(machineKey);
          await installedPlugins
            .read(machineKey, () => api.getInstalledPlugins(target.projectId, target.machineId))
            .catch(() => undefined);
        }
        if (!isCurrentVisit()) return;
      }
      installedPlugins.accept(installedPluginsKey(target.projectId, null), next);
      // What landed may carry Agent content: the library (and the registry's rows) are read
      // again, so the card's install flow moves on to the Agents without a reload.
      if (install && target.machineId === selfId) {
        pluginLibrary.invalidate(LIBRARY_KEY);
        pluginIndex.invalidate(INDEX_KEY);
        void reloadAgents().catch(() => undefined);
      }
      const row = next.plugins.find((p) => p.specifier === specifier);
      if (install && next.loading === true) {
        toastSuccess(S.plugins.installModel.loadingToast(specifier));
      } else if (install && next.installed?.from === "offline") {
        toastSuccess(S.plugins.installModel.offlineToast(specifier));
      } else if (install && row?.error !== undefined) {
        toastFailure(
          toldFailure(S.plugins.deploymentFailedToast(specifier, row.error), {
            what: "a plugin failed to load after it was installed",
            facts: [["Plugin", specifier]],
            detail: row.error,
          }),
        );
      } else {
        toastSuccess(install ? S.plugins.deploymentInstalledToast(specifier) : S.common.saved);
      }
    } catch (e) {
      // A failed install is said under its card, with the next steps; a failed removal toasts.
      if (isCurrentVisit()) {
        if (install) {
          failInstall(specifier, {
            failure: failureOf(e, { what: "a plugin could not be installed on the server" }),
            stage: lastStage,
            progress: lastProgress,
          });
        } else toastApiError(e);
      }
    } finally {
      if (isCurrentVisit()) {
        setPendingSpecifier(null);
        setInstallProgress(null);
        setInstallStage(null);
        setPendingApply(null);
      }
    }
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
    setPendingSpecifier(target.specifier);
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
      setPendingSpecifier(null);
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
      name: row.name,
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
      setPendingBulk(null);
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
  const searching = query.trim() !== "";
  // The tabs come from the whole list, not the search's matches, so typing never moves them.
  const sections = groupBy === "none" ? [] : groupRows(rows, statusOf, groupBy, categories);
  const tab = tabRows(sections, tabParam, rows, query);
  const activeTab = tab.active;
  /** The market's popularity figures (placeholders for now; see plugin-market.ts), or null. */
  const popularity = popularityOf(market);
  const sorts = availableSorts(popularity);
  /** The sort on show: a stored "popular" reads as the curation's order while no figures exist. */
  const shownSort = sorts.includes(sort) ? sort : "featured";
  const visible = sortRows(tab.rows, shownSort, {
    title: (row) => rowTitle(row, locale),
    selected: market?.selected ?? [],
    usedBy: (row) => usages.get(row.key)?.usedBy.length ?? 0,
    popularity,
  });
  const categoryTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? id;
  /**
   * The row a link's `?plugin=` names; its detail opens even when its card is not in the grid.
   * With `machine=`, that machine's row of the name; a machine no longer listed, or one that
   * has no such row, opens this server's.
   */
  const detailMachine = params.get(DETAIL_MACHINE_PARAM);
  const detailMarket = machineMarkets.find((m) => m.machineId === detailMachine);
  const openRow =
    openName === null
      ? undefined
      : ((detailMarket === undefined
          ? undefined
          : marketRows(
              { all: false, machineId: detailMarket.machineId },
              here,
              machineMarkets,
              null,
            ).find((row) => row.name === openName)) ?? rows.find((row) => row.name === openName));

  const cardProps = (row: PluginRow): PluginCardProps => {
    const choices = targetsFor(row);
    const current = rowCurrentTarget(row, choices, currentAgent?.agentId, (t) =>
      row.library === undefined ? false : pluginComplete(row.library, installed.get(t.key)),
    );
    /** The machine a module change of this row is listed for, in this server's tables. */
    const rowMachine = moduleTarget(row, viewMachine);
    const live = row.origin?.live !== false;
    const ownPackage = offersPackageUpdate(row);
    return {
      marketCard: true,
      layout: layout === "list" ? "row" : "cover",
      currentAgentId: current?.key,
      // The first row of that name, should two packages share one: one detail at a time.
      detailOpen: row === openRow,
      onDetailOpenChange: (open) => (open ? openDetail(row) : closeDetail()),
      art: artOf(market, row),
      selected: isSelected(market, row),
      onOpenApp: (appId) => void navigate(appWindowPath(appId)),
      row,
      status: statusOf(row),
      usage: usages.get(row.key) ?? null,
      categoryTitle: categoryTitle(row.category),
      // Outside its category's own tab, a card names its category.
      showCategory: groupBy !== "category" || activeTab === ALL_TAB,
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
      busy:
        row.module !== undefined &&
        pendingSpecifier === row.module.specifier &&
        !serverUninstalling,
      progress:
        row.module !== undefined && installProgress?.specifier === row.module.specifier
          ? installProgress
          : null,
      stage:
        row.module !== undefined && installStage?.specifier === row.module.specifier
          ? installStage.stage
          : null,
      failure:
        row.module !== undefined ? (installFailures.get(row.module.specifier) ?? null) : null,
      remoteInstall: rowMachine !== undefined && selfId !== undefined && rowMachine !== selfId,
      onDismissFailure: () => {
        if (row.module !== undefined) failInstall(row.module.specifier, null);
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
      blocked: rowBlocked(row, viewMachine, pendingSpecifier),
      onQuickStart: (plugin) => quickStartLibrary(plugin, current),
      onToggleInstall: toggleInstall,
      onUpdateOutdated: updateOutdated,
      // The update offer reads this server's own install, so only this server's cards make it.
      showPackageUpdates: ownPackage && (allMachines || viewingHere),
      onModuleApply: (install, version) => {
        if (row.module !== undefined && projectId !== null && rowMachine !== undefined) {
          setPendingApply({
            specifier: row.module.specifier,
            name: row.name,
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
  // Keyed by the package, not the row: a market row becomes a library row once the server has it,
  // and the card (with its open install flow) must stay mounted through that. A machine's card
  // keeps its machine in the key, beside this server's card of the same package.
  const card = (row: PluginRow) => (
    <PluginCard
      key={`${row.origin === undefined ? "" : `${row.origin.machineId}/`}${
        row.module?.specifier ?? row.library?.package ?? row.key
      }`}
      {...cardProps(row)}
    />
  );
  const tabs = [
    { key: ALL_TAB, label: S.plugins.tabAll },
    ...sections.map((s) => ({ key: s.id, label: s.title })),
  ];

  // The scrollbar gutter stays reserved: a search that shortens the page below the viewport
  // would otherwise take the scrollbar with it and shift everything sideways as it is typed.
  return (
    <PageFrame className="[scrollbar-gutter:stable]">
      {/* The options loaded plugins declare live on the Settings dialog's Plugins page, an
          admin's page; the header's Settings button opens the dialog there rather than sending
          anyone through the user menu to find it. */}
      <PageHeader
        title={S.plugins.pageTitle}
        info={S.plugins.pageDesc}
        actions={
          <PluginsHeaderActions
            query={query}
            onQuery={setQuery}
            isAdmin={isAdmin}
            machinePicker={
              otherMachines.length > 0 ? (
                <MachinePicker
                  aria-label={S.plugins.viewMachine}
                  choices={machineChoices}
                  value={allMachines ? ALL_MACHINES : (viewMachine ?? SELF_PENDING)}
                  onChange={(id) => {
                    if (id !== SELF_PENDING) setPickedMachine(id === ALL_MACHINES ? null : id);
                  }}
                />
              ) : null
            }
            onOpenSettings={() => {
              setSettingsSection("plugins");
              setSettingsOpen(true);
            }}
            onImport={() => setImportOpen(true)}
          />
        }
      >
        {/* Last stop on the plugins trail: what the sidebar's dot was pointing at, the control
          that takes all of it in one press, and the way to clear it for someone who has looked
          and decided to stay on the installed copies. A plugin is never NEW here — one nobody
          has installed is not waiting for anyone — so the line states the upgradable count
          alone rather than padding it with a zero. The per-card update buttons below remain
          the way to take just one. */}
        {todo && (
          <TodoNotice
            text={S.todo.changesUpgradable(noticeCounts(todo).updated)}
            actionLabel={S.todo.updateNow}
            busy={bulkRunning}
            onAction={() => setPendingBulk(pluginUpdatePlan(agents))}
            dismissLabel={S.todo.dismiss}
            onDismiss={() => dismissTodo(projectId, "plugins", todo.signature)}
          />
        )}
        {indexFailures.length > 0 && (
          <SourceFailuresNotice failures={indexFailures} className="mt-4" />
        )}
        {indexPending > 0 && (
          <Notice tone="attention" className="mt-4">
            {S.pluginRegistry.sourcePending(indexPending)}
          </Notice>
        )}
        {/* While searching, sources still loading mean the results — and especially an empty
            result — are not yet final: say so rather than let noMatch read as "does not exist". */}
        {searching && (indexPending > 0 || (registry.reading && index === null)) && (
          <Notice tone="attention" className="mt-4">
            {S.pluginRegistry.searchWhileDownloading}
          </Notice>
        )}
        {/* A machine whose cards stand as last answered: out of reach, or a read failed. */}
        {offlineMarkets.length > 0 && (
          <Notice
            tone="attention"
            className="mt-4"
            {...(offlineMarkets.some((m) => m.retryable)
              ? {
                  retry: {
                    label: S.common.retry,
                    onClick: () =>
                      offlineMarkets.filter((m) => m.retryable).forEach((m) => m.refresh()),
                  },
                }
              : {})}
          >
            {S.appCenter.machinesOffline(offlineMarkets.map((m) => m.label).join(", "))}
          </Notice>
        )}
        {/* Only while there is no answer to show: a failed re-read changes nothing on screen. */}
        {fallbackKey !== null &&
          viewMachine !== undefined &&
          fallback.value === null &&
          fallback.error !== null && (
            <Notice tone="attention" className="mt-4">
              {S.plugins.machineUnreadable(nameOf(viewMachine), fallback.error)}
            </Notice>
          )}
        {deployment !== null && viewingHere && deployment.restartPending && (
          <Notice tone="attention" className="mt-4">
            {S.plugins.restartPending}
          </Notice>
        )}
        <IncompatibleNotice unsatisfied={unsatisfiedCount} />
        <ModuleRequestsNotice
          waiting={isAdmin ? (moduleRequests.value?.pending ?? 0) : 0}
          onView={() => {
            setSettingsSection("moduleRequests");
            setSettingsOpen(true);
          }}
        />
      </PageHeader>
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

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PluginsListControls
              groupBy={groupBy}
              onGroupBy={(by) => {
                chooseGroupBy(by);
                // The tab on show belongs to the grouping it came from.
                if (tabParam !== null) selectTab(ALL_TAB);
              }}
              sort={shownSort}
              sorts={sorts}
              onSort={chooseSort}
              locale={locale}
            />
          </div>
          <ShowcaseLayoutToggle
            value={layout}
            onChange={chooseLayout}
            labels={{
              group: S.plugins.layoutLabel,
              cards: S.plugins.cardsLayout,
              list: S.plugins.listLayout,
            }}
          />
        </div>
        {groupBy !== "none" && <Tabs items={tabs} active={activeTab} onChange={selectTab} />}
      </div>

      {error && rows.length === 0 ? (
        <div className="mt-2 flex items-center gap-3">
          <p className={`text-sm ${toneInk.danger}`}>{error}</p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {S.common.retry}
          </Button>
        </div>
      ) : groups === null && rows.length === 0 ? (
        // The cards' own grid, so the placeholders stand in the columns the cards will take.
        <Waiting>
          <ShowcaseGrid
            layout={layout}
            className="lg:[--showcase-column-min:12rem] xl:[--showcase-column-min:14rem]"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <CoverCardSkeleton key={i} />
            ))}
          </ShowcaseGrid>
        </Waiting>
      ) : visible.length > 0 ? (
        <ShowcaseGrid
          layout={layout}
          className="lg:[--showcase-column-min:12rem] xl:[--showcase-column-min:14rem]"
        >
          {visible.map(card)}
        </ShowcaseGrid>
      ) : tab.elsewhere > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 px-1 text-sm text-fg-muted">
          <span>{S.plugins.noMatchHere(tab.elsewhere)}</span>
          <Button size="sm" variant="link" onClick={() => selectTab(ALL_TAB)}>
            {S.plugins.showAllResults}
          </Button>
        </p>
      ) : (
        <p className="px-1 text-sm text-fg-muted">
          {searching && (indexPending > 0 || (registry.reading && index === null))
            ? S.pluginRegistry.searchWhileDownloading
            : S.plugins.noMatch}
        </p>
      )}
      {/* The plugin a link names, when its card is not in the grid: its dialogs alone. */}
      {openRow !== undefined && !visible.includes(openRow) && (
        <PluginCard key={`open:${openRow.key}`} {...cardProps(openRow)} surface="none" />
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
      {/* Bulk update confirmation. Same warning as the per-plugin confirm — an update is an
          overwriting reinstall — and the same primary (overwrite) tone, with the list naming
          every plugin the batch would rewrite. Confirm-first is the point of the button: it
          overwrites many installs in one press, and a single one already asks. */}
      {pendingBulk !== null && (
        <ConfirmModal
          open
          title={S.todo.pluginsConfirmTitle(pendingBulk.plugins.length)}
          tone="primary"
          // As wide as a single plugin's update confirmation, which lists versions.
          widthClass="sm:max-w-lg"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={bulkRunning}
          onClose={() => setPendingBulk(null)}
          onConfirm={() => void runBulkUpdate(pendingBulk)}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">{S.todo.pluginsConfirmBody}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.todo.willTouch}</p>
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingBulk.plugins.map((name) => (
                <li key={name} className="px-3 py-1.5 font-mono text-xs">
                  {name}
                </li>
              ))}
            </ul>
            {/* The reinstalls write each plugin's stdio servers again: what they run here is
                said before they do, as a single install says it. */}
            <StdioDisclosure
              plugins={(groups ?? [])
                .flatMap((group) => group.plugins)
                .filter((plugin) => pendingBulk.plugins.includes(plugin.name))}
            />
          </div>
        </ConfirmModal>
      )}
    </PageFrame>
  );
}

/** How many listed plugins cannot run on this version of the host. */
export function IncompatibleNotice({ unsatisfied }: { unsatisfied: number }) {
  return unsatisfied > 0 ? (
    <Notice tone="attention" className="mt-4">
      {S.plugins.unsatisfiedNotice(unsatisfied)}
    </Notice>
  ) : null;
}

/**
 * Each select's width beside the tabs, by language: wide enough for its longest option there
 * (a select's menu is as wide as the select), and no wider, since every pixel it takes is one
 * the tabs do not have.
 */
const CONTROL_WIDTH: Record<"zh" | "en", { groupBy: string; sort: string }> = {
  zh: { groupBy: "sm:w-28", sort: "sm:w-36" },
  en: { groupBy: "sm:w-40", sort: "sm:w-52" },
};

/**
 * The tab row's end: the grouping select, whose options each say what they do ("Group by
 * status") while its accessible name says what it groups, and beside it the sort select. Both on
 * the small rung, each wide enough for its longest option in the UI language; on a phone they
 * share their line, each taking half.
 */
export function PluginsListControls({
  groupBy,
  onGroupBy,
  sort,
  sorts,
  onSort,
  locale,
}: {
  groupBy: PluginGroupBy;
  onGroupBy: (by: PluginGroupBy) => void;
  sort: PluginSort;
  /** The sorts on offer ("popular" only while the market sends popularity figures). */
  sorts: readonly PluginSort[];
  onSort: (sort: PluginSort) => void;
  locale: "zh" | "en";
}) {
  const width = CONTROL_WIDTH[locale];
  return (
    <>
      <div className={`min-w-0 flex-1 sm:flex-none ${width.groupBy}`}>
        <Select
          size="sm"
          aria-label={S.plugins.groupByLabel}
          value={groupBy}
          onChange={(e) => onGroupBy(e.target.value as PluginGroupBy)}
        >
          {PLUGIN_GROUP_BYS.map((by) => (
            <option key={by} value={by}>
              {S.plugins.groupBy[by]}
            </option>
          ))}
        </Select>
      </div>
      <div className={`min-w-0 flex-1 sm:flex-none ${width.sort}`}>
        <Select
          size="sm"
          aria-label={S.plugins.sortLabel}
          value={sort}
          onChange={(e) => onSort(e.target.value as PluginSort)}
        >
          {sorts.map((key) => (
            <option key={key} value={key}>
              {S.plugins.sort[key]}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

/**
 * The administrator's notice beside the incompatible-plugins one, while members' requests to run a
 * plugin's server module wait on this server: how many, and the way to the Settings dialog's
 * module requests page, where they are decided. Nothing while none waits.
 */
export function ModuleRequestsNotice({
  waiting,
  onView,
}: {
  /** How many requests wait for a decision. */
  waiting: number;
  onView: () => void;
}) {
  if (waiting === 0) return null;
  return (
    <Notice
      tone="attention"
      className="mt-4"
      action={{ label: S.plugins.moduleRequestsView, onClick: onView }}
    >
      {S.plugins.moduleRequestsNotice(waiting)}
    </Notice>
  );
}

/** Search the catalog. Administrators may also choose a machine, import a plugin or open Settings. */
export function PluginsHeaderActions({
  query,
  onQuery,
  isAdmin,
  machinePicker,
  onOpenSettings,
  onImport,
}: {
  query: string;
  onQuery: (query: string) => void;
  isAdmin: boolean;
  /** The machine picker, when there is another machine to pick; null otherwise. */
  machinePicker: React.ReactNode;
  onOpenSettings: () => void;
  /** Opens the import dialog (shown to an admin only: installing is the server's). */
  onImport: () => void;
}) {
  return (
    <>
      <div className="min-w-0 basis-full sm:w-56 sm:basis-auto">
        <SearchInput
          size="sm"
          value={query}
          placeholder={S.plugins.searchPlaceholder}
          aria-label={S.plugins.searchPlaceholder}
          onChange={onQuery}
        />
      </div>
      {isAdmin && (
        <>
          {machinePicker}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={onImport}>
              <GlyphIcon d={ICONS.upload} />
              {S.plugins.importPlugin}
            </Button>
            <Button size="sm" variant="secondary" onClick={onOpenSettings}>
              <GlyphIcon d={ICONS.gear} />
              {S.plugins.openSettings}
            </Button>
          </div>
        </>
      )}
    </>
  );
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
