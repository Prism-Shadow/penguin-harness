/**
 * The plugin market: every plugin as one card (plugin-card.tsx) — the library's plugins
 * (Skills and/or a hook package, loaded by core from the @penguinharness/* packages and
 * installed on Agents) and the server modules a Project can ask for (the Agent Sandbox backends
 * and whatever the registry lists, installed on the server by an admin). Cards sit in
 * collapsible sections, by category unless the reader picks another grouping; a row of small
 * selects under the title (the Cost Center's header shape) changes the grouping — category,
 * status, contents, or none — and filters by category, contents and status, beside the title
 * row's search box. The grouping and which sections are folded are remembered per browser
 * (plugin-groups.ts); the filters are not. Clicking a card opens its detail dialog
 * (plugin-detail.tsx); the status rules are plugin-status.ts.
 *
 * - A library plugin is installed per Agent, by any member, through its card's "manage
 *   installs" dialog; the update nudge appears when the server lists some Agent's copy as
 *   behind (`AgentSummary.pluginUpdates` — the page never compares versions itself), and the
 *   notice under the title updates every outdated plugin at once. Installed means the whole
 *   plugin: every one of its skills in the Agent's installed skills and, when it ships a hook
 *   package, that package in the Agent's installed hooks — which is why the page fetches both
 *   lists per Agent. Uninstall takes it apart the same way: one DELETE per skill and one for
 *   the hook package.
 * - A server module is installed on the whole server for every Project, by an admin only (a
 *   member sees the card read-only). Installing or removing one re-assembles the App, which stops
 *   the agent runs in progress in every Project, so the confirm says what the install does and,
 *   in small type below, what it costs.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AgentSummary,
  HookItem,
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
  PluginItem,
  QuickStartItem,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  CollapsibleSection,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Notice,
  PageFrame,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  SkeletonCard,
  TodoNotice,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../../lib/bulk-update";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { MachinePicker, type MachineChoice } from "../machines/machine-picker";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { prepareNewChatDraft } from "../chat/new-chat";
import { localizedText } from "../chat/skill-use";
import { SettingsDialog } from "../settings/settings-dialog";
import { toneInk } from "../../lib/tone";
import { ModuleApplyBody, PluginCard, libraryQuickStart } from "./plugin-card";
import {
  NO_FILTERS,
  PLUGIN_GROUP_BYS,
  PLUGIN_KINDS,
  foldKey,
  groupRows,
  initialFoldedGroups,
  initialPluginsGroupBy,
  moduleParts,
  pluginCategories,
  pluginRows,
  rowKinds,
  rowMatches,
  storeFoldedGroups,
  storePluginsGroupBy,
  type PluginFilters,
  type PluginGroupBy,
  type PluginRow,
  type PluginView,
} from "./plugin-groups";
import {
  PLUGIN_STATUSES,
  libraryUsage,
  pluginComplete,
  pluginStatus,
  type AgentInstalls,
  type InstalledMap,
  type LibraryUsage,
  type PluginStatus,
} from "./plugin-status";

const NO_INSTALLS: AgentInstalls = { skills: new Map(), hooks: new Map() };

/** The two lists an install response carries, folded into one Agent's snapshot entry. */
function installsOf(
  skills: readonly SkillMetadataItem[],
  hooks: readonly HookItem[],
): AgentInstalls {
  return {
    skills: new Map(skills.map((s) => [s.name, s.version])),
    hooks: new Map(hooks.map((h) => [h.name, h.version])),
  };
}

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

/** The picker's value for all machines: a machine id is never this short. */
const ALL_MACHINES_CHOICE = "*";

export function PluginsPage() {
  useDocumentTitle(S.nav.plugins);
  const navigate = useNavigate();
  const { locale } = useLocale();
  const { user } = useAuth();
  const userId = user?.userId ?? null;
  const { currentProject, agents, currentAgent, setCurrentAgentId, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  /** The plugins trail's raised badge, or undefined — the notice under the title acts on it or clears it. */
  const todo = useUpdateBadges().todos.plugins;
  /** The bulk update's confirmation is open (null = closed); it holds the plan it will run. */
  const [pendingBulk, setPendingBulk] = useState<PluginUpdatePlan | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [groups, setGroups] = useState<PluginGroupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMap>(new Map());
  /** What this Project asks for of the module plugins, and which of those the process runs. */
  const [deployment, setDeployment] = useState<InstalledPluginsResponse | null>(null);
  /** The registry: every module plugin this deployment could ask for. */
  const [index, setIndex] = useState<PluginIndexEntry[] | null>(null);
  /**
   * Sources that answered with nothing. A published index that is down shortens the list
   * instead of emptying it (the server merges tolerantly), so the page has to say so — a
   * silently shorter list reads as "that plugin does not exist".
   */
  const [indexFailures, setIndexFailures] = useState<{ source: string; error: string }[]>([]);
  /** The specifier whose install or removal is running: the list is written one verb at a time. */
  const [pendingSpecifier, setPendingSpecifier] = useState<string | null>(null);
  const isAdmin = user?.isAdmin === true;
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Free text over names, descriptions and keywords. */
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<PluginFilters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useState<PluginGroupBy>(() => initialPluginsGroupBy());
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => initialFoldedGroups());

  const chooseGroupBy = (by: PluginGroupBy) => {
    setGroupBy(by);
    storePluginsGroupBy(by);
  };
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      storeFoldedGroups(next);
      return next;
    });

  // The Project's list, re-read whenever the Project changes; a read that fails leaves the
  // module rows without their state rather than failing the page.
  const reloadDeployment = useCallback(() => {
    if (projectId === null) return;
    api.getInstalledPlugins(projectId).then(setDeployment, () => setDeployment(null));
  }, [projectId]);
  useEffect(reloadDeployment, [reloadDeployment]);

  const { machineIds, machineLabels } = useSessions();
  /** The machine the page shows and edits: null for all machines, or a machine's own id. */
  const [viewMachine, setViewMachine] = useState<string | null>(null);
  useEffect(() => setViewMachine(null), [projectId]);
  const selfId = deployment?.machineId;
  /** What the viewed machine answered itself — or why it could not — when it is not this server. */
  const [remote, setRemote] = useState<
    | { machineId: string; res: InstalledPluginsResponse }
    | { machineId: string; error: string }
    | null
  >(null);
  // Read again after every change of the list: the machine is handed its part in the
  // background, so a row reads "not on that machine yet" until it has answered with it.
  useEffect(() => {
    setRemote(null);
    if (projectId === null || viewMachine === null || viewMachine === selfId) return;
    let cancelled = false;
    api.getInstalledPlugins(projectId, viewMachine).then(
      (res) => !cancelled && setRemote({ machineId: viewMachine, res }),
      (e: unknown) => !cancelled && setRemote({ machineId: viewMachine, error: apiErrorText(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, viewMachine, selfId, deployment]);
  const nameOf = (machineId: string) =>
    machineId === selfId ? S.plugins.thisServer : (machineLabels.get(machineId) ?? machineId);
  const view: PluginView = {
    machineId: viewMachine,
    remote: remote !== null && "res" in remote ? remote.res : null,
    nameOf,
  };
  /** Whether the machine in view is this server itself, or every machine including it. */
  const viewIncludesHere = viewMachine === null || viewMachine === selfId;
  // The picker offers the machines this Project reaches and any a table names; a deployment
  // with neither has one machine, and no picker.
  const otherMachines = [
    ...new Set([...machineIds, ...(deployment?.plugins ?? []).flatMap((p) => p.machines ?? [])]),
  ].filter((id) => id !== selfId);
  const machineChoices: MachineChoice[] = [
    { value: ALL_MACHINES_CHOICE, label: S.plugins.allMachines },
    ...(selfId === undefined ? [] : [selfId, ...otherMachines]).map((id) => ({
      value: id,
      label: nameOf(id),
    })),
  ];

  // The registry, fetched once on page entry.
  useEffect(() => {
    let cancelled = false;
    api.getPluginIndex().then(
      (res) => {
        if (cancelled) return;
        setIndex(res.plugins);
        setIndexFailures(res.failures ?? []);
      },
      () => {
        if (!cancelled) setIndex([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A server module change waiting for its confirmation (null = none). Applying one
   * re-assembles the App, which stops the agent runs in flight in EVERY Project — the same
   * cost a hot push has — so it is said before it is done.
   */
  const [pendingApply, setPendingApply] = useState<{
    specifier: string;
    name: string;
    install: boolean;
  } | null>(null);

  /**
   * Installs the package into the data root (fetched from npm unless this build ships it) and
   * lists it for this Project — writing the list alone would name a package that is not on
   * the machine, which is exactly the state the row would then have to report as broken. The
   * server re-assembles the App where it can, so the row's state afterwards is what the
   * running process has — including a load that failed, which is reported as such rather than
   * toasted as installed; otherwise the row waits for a restart.
   */
  const runDeploymentInstall = async (specifier: string, install: boolean) => {
    if (pendingSpecifier !== null || projectId === null) return;
    setPendingSpecifier(specifier);
    try {
      const next = install
        ? await api.installPlugin(projectId, specifier, viewMachine)
        : await api.uninstallPlugin(projectId, specifier, viewMachine);
      setDeployment(next);
      const row = next.plugins.find((p) => p.specifier === specifier);
      if (install && row?.error !== undefined) {
        toastError(S.plugins.deploymentFailedToast(specifier, row.error));
      } else {
        toastSuccess(install ? S.plugins.deploymentInstalledToast(specifier) : S.common.saved);
      }
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setPendingSpecifier(null);
      setPendingApply(null);
    }
  };

  // Library list: readable once logged in, fetched once on page entry.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getPluginLibrary()
      .then((res) => {
        if (!cancelled) setGroups(res.groups);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Installed skills and hook packages for every Agent in the current Project (fetched in
  // parallel, same convention as the sessions context): a single Agent's failure is silently
  // treated as "nothing installed" and doesn't break the whole page.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");
  useEffect(() => {
    // Clear the snapshot before fetching: agentId (e.g. default_agent) is
    // reused across Projects, and leftover state from the previous project
    // would otherwise overwrite the new data when merged below, leaving the
    // page permanently showing the old project's install state.
    setInstalled(new Map());
    if (!projectId || agentIdsKey === "") return;
    let cancelled = false;
    const ids = agentIdsKey.split(",");
    void Promise.all(
      ids.map(async (agentId) => {
        try {
          const [skills, hooks] = await Promise.all([
            api.getAgentSkills(projectId, agentId),
            api.getAgentHooks(projectId, agentId),
          ]);
          return [agentId, installsOf(skills.skills, hooks.hooks)] as const;
        } catch {
          return [agentId, NO_INSTALLS] as const;
        }
      }),
    ).then((entries) => {
      // Merge instead of replacing the whole table: an Agent the user has
      // already interacted with during the fetch keeps its interaction result
      // (an optimistic state or an install/uninstall response is newer than
      // this mount-time snapshot), so a late-arriving initial snapshot never
      // regresses the UI.
      if (!cancelled)
        setInstalled((prev) => {
          const next = new Map<string, AgentInstalls>(entries);
          for (const [agentId, m] of prev) next.set(agentId, m);
          return next;
        });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentIdsKey]);

  /** Rewrite one Agent's snapshot entry in place (shared by optimistic updates, install responses and failure rollback). */
  const setAgentInstalls = (agentId: string, installs: AgentInstalls) =>
    setInstalled((prev) => new Map(prev).set(agentId, installs));

  /**
   * One Agent's snapshot entry with a plugin marked present — each part at the library's own
   * version of it — or absent: its skills and, when it ships one, its hook package, all at once.
   */
  const withPlugin = (installs: AgentInstalls, plugin: PluginItem, on: boolean): AgentInstalls => {
    const skills = new Map(installs.skills);
    const hooks = new Map(installs.hooks);
    for (const skill of plugin.skills) {
      if (on) skills.set(skill.name, skill.version);
      else skills.delete(skill.name);
    }
    if (plugin.hooks.length > 0) {
      if (on) hooks.set(plugin.name, plugin.hookVersion ?? "");
      else hooks.delete(plugin.name);
    }
    return { skills, hooks };
  };

  /**
   * Install / uninstall on one Agent (any member can do this): optimistic update, a
   * confirmation toast on success, rollback plus a toast on failure. Install is one request for
   * the whole plugin; uninstall takes it apart — one DELETE per skill and one for the hook
   * package — since the server offers no plugin-level delete, and a plugin's parts are what an
   * Agent actually holds. The Agent list is re-read afterwards either way: the card's counts
   * and its `pluginUpdates` moved, and both are read off that list.
   */
  const toggleInstall = async (agentId: string, plugin: PluginItem, on: boolean) => {
    if (!projectId) return false;
    const prev = installed.get(agentId) ?? NO_INSTALLS;
    setAgentInstalls(agentId, withPlugin(prev, plugin, on));
    const target = agents.find((a) => a.agentId === agentId);
    const agentName = target ? agentDisplayName(target) : agentId;
    try {
      if (on) {
        const res = await api.installAgentPlugins(projectId, agentId, [plugin.name]);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
        toastSuccess(
          `${S.plugins.installedToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
        );
      } else {
        // A 404 on a part means "was already not installed": the target state is already
        // reached for that part, so it does not fail the uninstall (otherwise the row would be
        // stuck at "Installed" whenever this page's snapshot is stale).
        const gone = (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return;
          throw e;
        };
        await Promise.all([
          ...plugin.skills.map((skill) =>
            api.removeAgentSkill(projectId, agentId, skill.name).catch(gone),
          ),
          ...(plugin.hooks.length > 0
            ? [api.uninstallAgentHook(projectId, agentId, plugin.name).catch(gone)]
            : []),
        ]);
        toastSuccess(
          `${S.plugins.uninstalledToast(plugin.name, agentName)}${S.agent.takesEffectSuffix}`,
        );
      }
    } catch (e) {
      setAgentInstalls(agentId, prev);
      toastError(apiErrorText(e));
      return false;
    }
    void reloadAgents();
    return true;
  };

  /**
   * Update reminder action: reinstall the current library copy on every outdated Agent
   * (install-again-is-update semantics). One success toast for the whole batch; on partial
   * failure the succeeded Agents keep their calibrated state and the first error is toasted.
   */
  const updateOutdated = async (name: string, agentIds: string[]) => {
    if (!projectId || agentIds.length === 0) return;
    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const res = await api.installAgentPlugins(projectId, agentId, [name]);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!failed) toastSuccess(S.plugins.updatedToast(name, agentIds.length));
    else toastError(apiErrorText(failed.reason));
    // The outdated marks and the nav badge are both read off `AgentSummary.pluginUpdates`,
    // which this page's install map does not feed: without reloading the Agent list the dot
    // would survive the very update it led the user to. Runs after a partial failure too —
    // some Agent moved.
    void reloadAgents();
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
      plan.perAgent.map(async ({ agentId, names }) => {
        const res = await api.installAgentPlugins(projectId, agentId, names);
        setAgentInstalls(agentId, installsOf(res.skills, res.hooks));
      }),
    );
    const outcome = bulkOutcome(labels, results);
    if (outcome.allOk) toastSuccess(S.todo.bulkDone(outcome.ok));
    else {
      toastError(
        `${S.todo.bulkPartial(outcome.ok, failedList(outcome.failed, S.todo.listSeparator))} — ${apiErrorText(firstFailure(results))}`,
      );
    }
    // Runs after a partial failure too — some Agent moved, and the gate has to see it. Guarded,
    // because `reloadAgents` rejects on a failed list read and the busy flag disables every
    // control here, the dialog's Cancel included: a reload that failed after the writes landed
    // would otherwise leave the page frozen with nothing saying why.
    try {
      await reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
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
   * pre-selected and goal mode on when the demo is a goal. handoffAgentId must be cleared: a
   * leftover handoff target would forward the demo to a different Agent.
   */
  const openQuickStart = (quickStart: QuickStartItem) => {
    const agentId = currentAgent?.agentId;
    if (!agentId) return;
    if (userId && projectId) {
      // Typed-but-unsent draft text becomes a parked draft conversation instead of being
      // clobbered by the canned invocation body, and the Workspace and approval mode start on
      // the Project's new-chat defaults (new-chat.ts).
      prepareNewChatDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      const { skills: _skills, goal: _goal, ...rest } = loadDraft(key);
      saveDraft(key, {
        ...rest,
        agentId,
        text: localizedText(locale, quickStart.prompt, quickStart.promptZh),
        ...(quickStart.skills !== undefined && quickStart.skills.length > 0
          ? { skills: quickStart.skills }
          : {}),
        ...(quickStart.goal === true ? { goal: true as const } : {}),
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /** A library plugin waiting for "install on this Agent, then quick start" to be confirmed. */
  const [pendingQuickStart, setPendingQuickStart] = useState<PluginItem | null>(null);
  const [quickStartInstalling, setQuickStartInstalling] = useState(false);

  /** A library plugin's quick start: on an Agent that has all of it, it opens; otherwise installing comes first, and is asked. */
  const quickStartLibrary = (plugin: PluginItem) => {
    const demo = libraryQuickStart(plugin);
    if (demo === null || !currentAgent) return;
    if (pluginComplete(plugin, installed.get(currentAgent.agentId))) openQuickStart(demo);
    else setPendingQuickStart(plugin);
  };

  const confirmQuickStartInstall = async () => {
    const plugin = pendingQuickStart;
    const agentId = currentAgent?.agentId;
    if (plugin === null || !agentId) return;
    setQuickStartInstalling(true);
    const ok = await toggleInstall(agentId, plugin, true);
    setQuickStartInstalling(false);
    setPendingQuickStart(null);
    const demo = libraryQuickStart(plugin);
    if (ok && demo !== null) openQuickStart(demo);
  };

  const rows = pluginRows(groups ?? [], moduleParts(deployment, index ?? [], view));
  const categories = pluginCategories(groups ?? [], locale);
  const usages = new Map<string, LibraryUsage>();
  for (const row of rows) {
    if (row.library !== undefined) {
      usages.set(row.key, libraryUsage(row.library, agents, installed));
    }
  }
  const statusOf = (row: PluginRow): PluginStatus => pluginStatus(row, usages.get(row.key) ?? null);
  const filtering =
    query.trim() !== "" || filters.category !== "" || filters.kind !== "" || filters.status !== "";
  const visible = rows.filter((row) => rowMatches(row, statusOf(row), filters, query));
  const sections = groupRows(visible, statusOf, groupBy, categories);
  const categoryTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? id;

  const card = (row: PluginRow) => (
    <PluginCard
      key={row.key}
      row={row}
      status={statusOf(row)}
      usage={usages.get(row.key) ?? null}
      categoryTitle={categoryTitle(row.category)}
      showCategory={groupBy !== "category"}
      agents={agents}
      installed={installed}
      canQuickStart={currentAgent !== null}
      isAdmin={isAdmin}
      busy={row.module !== undefined && pendingSpecifier === row.module.specifier}
      blocked={
        row.module !== undefined &&
        pendingSpecifier !== null &&
        pendingSpecifier !== row.module.specifier
      }
      onQuickStart={quickStartLibrary}
      onToggleInstall={toggleInstall}
      onUpdateOutdated={updateOutdated}
      onModuleApply={(install) => {
        if (row.module !== undefined) {
          setPendingApply({ specifier: row.module.specifier, name: row.name, install });
        }
      }}
    />
  );

  // The scrollbar gutter stays reserved: a filter that shortens the page below the viewport
  // would otherwise take the scrollbar with it and shift everything sideways at the click.
  return (
    <PageFrame className="[scrollbar-gutter:stable]">
      {/* The wrapper is the @container the header buttons' words answer to (see
          PluginsHeaderActions). The options loaded plugins declare live on the Settings
          dialog's Plugins page, an admin's page; the header's gear opens the dialog there rather
          than sending anyone through the user menu to find it. */}
      <div className="@container">
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
                    value={viewMachine ?? ALL_MACHINES_CHOICE}
                    onChange={(v) => setViewMachine(v === ALL_MACHINES_CHOICE ? null : v)}
                  />
                ) : null
              }
              onOpenSettings={() => setSettingsOpen(true)}
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
            <Notice tone="attention" className="mt-4">
              {S.pluginRegistry.sourceUnavailable(indexFailures.length)}
            </Notice>
          )}
          {remote !== null && "error" in remote && remote.machineId === viewMachine && (
            <Notice tone="attention" className="mt-4">
              {S.plugins.machineUnreadable(nameOf(remote.machineId), remote.error)}
            </Notice>
          )}
          {deployment !== null && viewIncludesHere && deployment.restartPending && (
            <Notice tone="attention" className="mt-4">
              {S.plugins.restartPending}
            </Notice>
          )}
        </PageHeader>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        section="plugins"
      />

      {error ? (
        <div className="mt-2 flex items-center gap-3">
          <p className={`text-sm ${toneInk.danger}`}>{error}</p>
          <Button size="sm" onClick={() => window.location.reload()}>
            {S.common.retry}
          </Button>
        </div>
      ) : groups === null ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-4 w-3/4" />
              <Skeleton className="mt-3 h-6 w-36" />
            </SkeletonCard>
          ))}
        </div>
      ) : (
        <>
          <PluginControls
            groupBy={groupBy}
            onGroupBy={chooseGroupBy}
            filters={filters}
            onFilters={setFilters}
            rows={rows}
            statusOf={statusOf}
            categories={categories}
          />
          <div className="space-y-3">
            {groupBy === "none"
              ? sections.map((section) => (
                  <CardGrid key={section.id}>{section.rows.map(card)}</CardGrid>
                ))
              : sections.map((section) => {
                  const key = foldKey(groupBy, section.id);
                  // A match folded away would read as a missing one, so a search or a filter
                  // opens every section it leaves; the remembered folds come back after.
                  const open = filtering || !folded.has(key);
                  return (
                    <CollapsibleSection
                      key={key}
                      title={section.title}
                      meta={S.plugins.pluginCount(section.rows.length)}
                      open={open}
                      onOpenChange={() => toggleFold(key)}
                    >
                      <CardGrid>{section.rows.map(card)}</CardGrid>
                    </CollapsibleSection>
                  );
                })}
            {sections.length === 0 && (
              <p className="px-1 text-sm text-gray-400 dark:text-gray-500">{S.plugins.noMatch}</p>
            )}
          </div>
        </>
      )}

      {/* A server module change: what it does is said before it runs, and what it costs in
          small type under it. An install is primary; a removal is danger. */}
      {pendingApply !== null && (
        <ConfirmModal
          open
          title={
            pendingApply.install
              ? S.plugins.applyConfirmInstall(pendingApply.name)
              : S.plugins.applyConfirmRemove(pendingApply.name)
          }
          tone={pendingApply.install ? "primary" : "danger"}
          {...(pendingApply.install ? { glyph: ICONS.download } : {})}
          confirmLabel={pendingApply.install ? S.plugins.install : S.plugins.uninstall}
          cancelLabel={S.common.cancel}
          busy={pendingSpecifier !== null}
          onClose={() => setPendingApply(null)}
          onConfirm={() => void runDeploymentInstall(pendingApply.specifier, pendingApply.install)}
        >
          <ModuleApplyBody install={pendingApply.install} name={pendingApply.name} />
        </ConfirmModal>
      )}
      {/* A library plugin's quick start on an Agent that lacks it: installing comes first, and is asked. */}
      {pendingQuickStart !== null && currentAgent && (
        <ConfirmModal
          open
          title={S.plugins.quickStartInstallTitle(
            pendingQuickStart.name,
            agentDisplayName(currentAgent),
          )}
          tone="primary"
          confirmLabel={S.plugins.install}
          cancelLabel={S.common.cancel}
          busy={quickStartInstalling}
          onClose={() => setPendingQuickStart(null)}
          onConfirm={() => void confirmQuickStartInstall()}
        >
          <p>{S.plugins.quickStartAfterInstall}</p>
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
          </div>
        </ConfirmModal>
      )}
    </PageFrame>
  );
}

/** Cards in a section: two to a row once there is room, one on a phone. */
function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">{children}</div>;
}

/**
 * The row of small selects under the title — the Cost Center's header shape: the grouping,
 * then the three filters. Each filter offers only the values some plugin on the page has. The
 * selects sit side by side, so every option names its select — "Group: status" beside
 * "Status: available" — and each is wide enough for its longest English option. On a phone
 * they pair up, two to a row.
 */
export function PluginControls({
  groupBy,
  onGroupBy,
  filters,
  onFilters,
  rows,
  statusOf,
  categories,
}: {
  groupBy: PluginGroupBy;
  onGroupBy: (by: PluginGroupBy) => void;
  filters: PluginFilters;
  onFilters: (filters: PluginFilters) => void;
  rows: readonly PluginRow[];
  statusOf: (row: PluginRow) => PluginStatus;
  categories: readonly { id: string; title: string }[];
}) {
  const present = {
    categories: categories.filter((c) => rows.some((row) => row.category === c.id)),
    kinds: PLUGIN_KINDS.filter((k) => rows.some((row) => rowKinds(row).includes(k))),
    statuses: PLUGIN_STATUSES.filter((s) => rows.some((row) => statusOf(row) === s)),
  };
  const optionText = S.plugins.filterValue;
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="min-w-0 sm:w-40">
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
      <div className="min-w-0 sm:w-56">
        <Select
          size="sm"
          aria-label={S.plugins.filterCategories}
          value={filters.category}
          onChange={(e) => onFilters({ ...filters, category: e.target.value })}
        >
          <option value="">{optionText(S.plugins.filterCategories, S.plugins.filterAll)}</option>
          {present.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {optionText(S.plugins.filterCategories, c.title)}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0 sm:w-48">
        <Select
          size="sm"
          aria-label={S.plugins.filterKind}
          value={filters.kind}
          onChange={(e) => onFilters({ ...filters, kind: e.target.value as PluginFilters["kind"] })}
        >
          <option value="">{optionText(S.plugins.filterKind, S.plugins.filterAll)}</option>
          {present.kinds.map((k) => (
            <option key={k} value={k}>
              {optionText(S.plugins.filterKind, S.plugins.kindLabel[k])}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0 sm:w-48">
        <Select
          size="sm"
          aria-label={S.plugins.filterState}
          value={filters.status}
          onChange={(e) =>
            onFilters({ ...filters, status: e.target.value as PluginFilters["status"] })
          }
        >
          <option value="">{optionText(S.plugins.filterState, S.plugins.filterAll)}</option>
          {present.statuses.map((s) => (
            <option key={s} value={s}>
              {optionText(S.plugins.filterState, S.plugins.status[s])}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/**
 * The page header's actions, the Models page's shape: search for everyone (a member filters the
 * list too), then, for an admin, the machine picker (which machine's plugins the rows show, and
 * which table an install or a removal edits: the shared one, or that machine's own) and the gear
 * that opens the Settings dialog's Plugins page. The gear's words sit beside its icon once the
 * header's `@container` is wide enough.
 */
export function PluginsHeaderActions({
  query,
  onQuery,
  isAdmin,
  machinePicker,
  onOpenSettings,
}: {
  query: string;
  onQuery: (query: string) => void;
  isAdmin: boolean;
  /** The machine picker, when there is another machine to pick; null otherwise. */
  machinePicker: React.ReactNode;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
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
          <Button
            size="sm"
            className="h-8 shrink-0"
            aria-label={S.plugins.openSettings}
            title={S.plugins.openSettings}
            onClick={onOpenSettings}
          >
            <GlyphIcon d={ICONS.gear} size={ICON_SIZE.iconButton} />
            <span className="hidden @3xl:inline">{S.plugins.openSettings}</span>
          </Button>
        </>
      )}
    </>
  );
}
