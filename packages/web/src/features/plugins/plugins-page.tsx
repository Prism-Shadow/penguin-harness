/**
 * Plugin library page: the built-in plugin library (loaded by core from the @penguinharness/* packages), shown sectioned by category.
 * A plugin ships skills and/or a hook package (scripts the harness runs at the loop's hook
 * points, e.g. after every Task), and is installed on an Agent as a whole. Groups are
 * borderless — the group header (category name + plugin count, no icon) is collapsible,
 * highlights on hover, and animates height on expand/collapse; expanded by default. Cards
 * within a group form a grid, generously sized: two per row from the sm breakpoint up, one per
 * row on narrow screens. Each card = a rounded icon tile centered against the two text rows
 * (its color comes from skillTileColor — a per-name palette hashed from the plugin name; DTO
 * icon = the plugin's raw icon.svg (beside plugin.json), rendered inline once it passes
 * sanitize, otherwise the puzzle piece) + a name (monospace) and short description on the
 * right, one line each
 * (single-line truncation, falling back to the full description when missing) + a line below
 * both with what the plugin contains ("N skills", one "<event> hook" badge per hook point)
 * and its metadata (version · usage count "used by N Agents"); group and card copy follow the
 * UI language (localizedText / localizedShortText), and groups have no description. Icon
 * buttons for actions (copy goes into aria-label and title) —
 * - Rotate "update installs" (shown only when the server lists some Agent's installed copy
 *   behind the library — `AgentSummary.pluginUpdates`; the page never compares versions
 *   itself): opens a confirm dialog (lists each Agent's old → new version and warns the
 *   overwriting reinstall drops local edits), then reinstalls the current library copy on
 *   every outdated Agent (install-again-is-update semantics), with a single success toast; the
 *   manage-installs Modal marks outdated rows with an accent "Update" button doing the same per
 *   Agent (through the same confirm);
 * - Paper plane "quick start" (plugins with at least one skill): enters /chat/new draft mode on
 *   the currently selected agent, pre-selects one of the plugin's skills the agent has
 *   installed, and pre-fills the invocation text per UI language ("use the X skill" in the
 *   active dictionary, overwriting any existing draft body); disabled unless that agent has
 *   one of the plugin's skills installed — quick start opens the draft there, so it can't
 *   pre-select a skill the current agent lacks;
 * - Download "manage installs": a Modal listing every Agent in the current Project —
 *   not-installed shows "Install", installed shows "Installed" (hover switches to
 *   "Uninstall", click to uninstall); any member can operate it; optimistic update, a
 *   top-level toast on success for install/uninstall, rollback plus a toast on failure.
 *   Installed means the whole plugin is: every one of its skills is in the Agent's installed
 *   skills and, when it ships a hook package, that package is in the Agent's installed hooks —
 *   which is why the page fetches both lists per Agent. Uninstall takes the plugin apart the
 *   same way: one DELETE per skill and one for the hook package.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type {
  AgentSummary,
  HookItem,
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
  PluginItem,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
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
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { GEAR_ICON, NAV_ICONS, PLUGIN_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { TRASH_ICON } from "../../components/ui/session-row-menu";
import { StatusIcon } from "../../components/ui/status-icon";
import { TodoNotice } from "../../components/ui/todo-notice";
import { UpdateDot } from "../../components/ui/update-dot";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { parkActiveDraft } from "../chat/draft-sessions";
import { localizedShortText, localizedText } from "../chat/skill-use";
import { PluginDetailModal } from "./plugin-detail";
import { SettingsDialog } from "../settings/settings-dialog";
import { formatRelativeDate } from "../../lib/format";
import { SkillTile } from "../skills/skill-icon-view";
import { InfoPopover } from "../../components/ui/info-popover";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneStrip, toneSurface } from "../../lib/tone";
import { Input } from "../../components/ui/input";

/**
 * What one Agent has installed, by name → the installed copy's version (`YYYY.MM.DD.N`, or ""
 * when the files carry none): its skills and its hook packages, the two lists a plugin is
 * spread over.
 */
export interface AgentInstalls {
  skills: ReadonlyMap<string, string>;
  hooks: ReadonlyMap<string, string>;
}

/** agentId → what is installed there; in-page install-state snapshot, rewritten in place by optimistic updates. */
export type InstalledMap = ReadonlyMap<string, AgentInstalls>;

/** The three fields of a plugin the install questions below read (the card passes the whole DTO; tests can pass just these). */
export type PluginParts = Pick<PluginItem, "name" | "skills" | "hooks">;

/** "Quick start" button icon (paper plane, 24×24 line path; button shows only the icon, copy goes into aria/title). */
const SEND_ICON = "M22 2 11 13M22 2 15 22 11 13 2 9 22 2";
/** "Manage installs" button icon (download into tray, 24×24 line path). */
const INSTALL_ICON = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";
/** "Update installs" button icon (rotate-cw, 24×24 line path). */
const UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

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
 * Whether a plugin is installed on an Agent, meaning any part of it is: one of its skills is in
 * the Agent's installed skills, or (when it ships a hook package) that package — named after
 * the plugin — is in the Agent's installed hooks. A partial copy counts: an install of an older
 * version that shipped fewer skills, or one a skill was removed from in the Skills tab, is what
 * the server lists as behind and what an update (a whole reinstall) completes; "all parts"
 * would call it not installed and hide the update.
 */
export function pluginInstalled(plugin: PluginParts, installs: AgentInstalls | undefined): boolean {
  if (installs === undefined) return false;
  return (
    plugin.skills.some((skill) => installs.skills.has(skill.name)) ||
    (plugin.hooks.length > 0 && installs.hooks.has(plugin.name))
  );
}

/**
 * The version of a plugin's installed copy on one Agent, read off its hook package where it has
 * one and off its first installed skill otherwise (a plugin's parts ship at the plugin's
 * version), or undefined when the plugin is not installed there. Only ever displayed — the
 * "old → new" line of the update confirmation — never compared.
 */
export function installedPluginVersion(
  plugin: PluginParts,
  installs: AgentInstalls | undefined,
): string | undefined {
  if (installs === undefined) return undefined;
  if (plugin.hooks.length > 0) return installs.hooks.get(plugin.name);
  for (const skill of plugin.skills) {
    const version = installs.skills.get(skill.name);
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * Agents the server says are behind the library on plugin `name` (the update reminder's data
 * source): read off `AgentSummary.pluginUpdates`, the same field the plugins gate counts, so
 * the card, the notice and the nav dot cannot disagree — and so the web never compares
 * `YYYY.MM.DD.N` strings itself. Not-installed Agents are never listed there.
 */
export function outdatedAgentIds(
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "pluginUpdates">>,
  name: string,
): string[] {
  return agents
    .filter((agent) => agent.pluginUpdates.some((update) => update.name === name))
    .map((agent) => agent.agentId);
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
  /** The specifier whose install or removal is running: the list is written one verb at a time. */
  const [pendingSpecifier, setPendingSpecifier] = useState<string | null>(null);
  const isAdmin = user?.isAdmin === true;
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Free text over name, specifier and description. */
  const [query, setQuery] = useState("");
  /** The filter column's choices: a row shows when it carries one selected category and every selected tag. */
  const [pickedCategories, setPickedCategories] = useState<ReadonlySet<string>>(new Set());
  const [pickedKinds, setPickedKinds] = useState<ReadonlySet<PluginKind>>(new Set());
  const [pickedStates, setPickedStates] = useState<ReadonlySet<PluginState>>(new Set());
  /** The installed list starts folded — it is the long one; a search or a filter opens both. */
  const [installedOpen, setInstalledOpen] = useState(false);
  const [availableOpen, setAvailableOpen] = useState(true);

  // The Project's list, re-read whenever the Project changes; a read that fails leaves the
  // module rows without their state rather than failing the page.
  const reloadDeployment = useCallback(() => {
    if (projectId === null) return;
    api.getInstalledPlugins(projectId).then(setDeployment, () => setDeployment(null));
  }, [projectId]);
  useEffect(reloadDeployment, [reloadDeployment]);

  // The registry, fetched once on page entry.
  useEffect(() => {
    let cancelled = false;
    api.getPluginIndex().then(
      (res) => {
        if (!cancelled) setIndex(res.plugins);
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
   * A module plugin change waiting for its confirmation (null = none). Applying one
   * re-assembles the App, which stops the agent runs in flight in EVERY Project — the same
   * cost a hot push has — so it is said before it is done.
   */
  const [pendingApply, setPendingApply] = useState<{ specifier: string; install: boolean } | null>(
    null,
  );

  /**
   * Asks this Project for a module plugin (or drops it); the server lists it and re-assembles
   * the App, so the row's state afterwards is what the running process has — including a
   * load that failed, which is reported as such rather than toasted as installed.
   */
  const runDeploymentInstall = async (specifier: string, install: boolean) => {
    if (pendingSpecifier !== null || projectId === null) return;
    setPendingSpecifier(specifier);
    try {
      const next = install
        ? await api.installPlugin(projectId, specifier)
        : await api.uninstallPlugin(projectId, specifier);
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
   * One Agent's snapshot entry with a plugin marked present (at the library's version) or
   * absent — its skills and, when it ships one, its hook package, all at once.
   */
  const withPlugin = (installs: AgentInstalls, plugin: PluginItem, on: boolean): AgentInstalls => {
    const skills = new Map(installs.skills);
    const hooks = new Map(installs.hooks);
    for (const skill of plugin.skills) {
      if (on) skills.set(skill.name, plugin.version);
      else skills.delete(skill.name);
    }
    if (plugin.hooks.length > 0) {
      if (on) hooks.set(plugin.name, plugin.version);
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
    if (!projectId) return;
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
      return;
    }
    void reloadAgents();
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
   * Quick start: pre-selects one of the plugin's skills in the draft cache (the `skills`
   * field, used by ChatInput as its initial selection on mount), pre-fills the invocation text
   * per UI language (overwriting any existing draft body — quick start's intent is
   * unambiguous, and leftover draft text would only be noise here), and opens the draft on the
   * currently selected Agent — the route state carries its agentId explicitly. handoffAgentId
   * must be cleared: a leftover handoff target would forward the whole skill invocation to a
   * different Agent. The button is gated on the current Agent having the skill (see
   * PluginCard.quickStartSkill), so agentId is present here.
   */
  const quickInvoke = (skillName: string) => {
    const agentId = currentAgent?.agentId;
    if (!agentId) return;
    if (userId && projectId) {
      // Typed-but-unsent draft text becomes a parked draft conversation instead of being
      // clobbered by the canned invocation body (draft-sessions.ts).
      parkActiveDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      saveDraft(key, {
        ...loadDraft(key),
        agentId,
        text: S.skills.quickInvokeText(skillName),
        skills: [skillName],
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  const allInstalled = installedPluginRows(groups ?? [], locale, deployment, index ?? []);
  const allAvailable = availablePluginRows(deployment, index ?? []);
  const facets = pluginFacets([...allInstalled, ...allAvailable]);
  const picked = { categories: pickedCategories, kinds: pickedKinds, states: pickedStates };
  const filtering =
    query.trim() !== "" ||
    pickedCategories.size > 0 ||
    pickedKinds.size > 0 ||
    pickedStates.size > 0;
  const keep = (row: PluginRow) => rowMatches(row, query, picked);
  const installedRows = allInstalled.filter(keep);
  const availableRows = allAvailable.filter(keep);
  const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  // The scrollbar gutter stays reserved: a filter that shortens the page below the viewport
  // would otherwise take the scrollbar with it and shift everything sideways at the click.
  return (
    <div className="h-full overflow-y-auto p-4 [scrollbar-gutter:stable] md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            {S.plugins.pageTitle}
            <InfoPopover label={S.plugins.pageTitle}>{S.plugins.pageDesc}</InfoPopover>
          </h1>
          {/* The options loaded plugins declare live on the Settings dialog's Plugins page, an
              admin's page; this opens the dialog there rather than sending anyone through the
              user menu to find it. */}
          {isAdmin && (
            <Button
              size="sm"
              className="h-8 w-8 shrink-0 justify-center p-0"
              aria-label={S.plugins.openSettings}
              title={S.plugins.openSettings}
              onClick={() => setSettingsOpen(true)}
            >
              <GlyphIcon d={GEAR_ICON} size={ICON_SIZE.iconButton} />
            </Button>
          )}
        </div>
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          section="plugins"
        />
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

        {deployment !== null && deployment.restartPending && (
          <div className={`mt-4 rounded-md px-3 py-2 text-xs ${toneStrip.attention}`}>
            {S.plugins.restartPending}
          </div>
        )}

        {error ? (
          <div className="mt-6 flex items-center gap-3">
            <p className={`text-sm ${toneInk.danger}`}>{error}</p>
            <Button size="sm" onClick={() => window.location.reload()}>
              {S.common.retry}
            </Button>
          </div>
        ) : groups === null ? (
          <div className="mt-6 grid grid-cols-1 gap-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} className="p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-6 w-36" />
              </SkeletonCard>
            ))}
          </div>
        ) : (
          <div className="mt-6 md:grid md:grid-cols-[minmax(0,1fr)_12rem] md:gap-4">
            <div className="min-w-0 space-y-3">
              <Input
                size="sm"
                type="search"
                value={query}
                placeholder={S.plugins.searchPlaceholder}
                aria-label={S.plugins.searchPlaceholder}
                onChange={(e) => setQuery(e.target.value)}
              />
              {/* ONE list, one plugin per row, every kind in the same card: what is installed
                  first — the library's plugins (they ship with the build and every Agent may use
                  them) and the module plugins this Project asks for — then what could be. A
                  plugin's category is a tag on its row, not a group around it. */}
              <PluginList
                title={S.plugins.installedSection(installedRows.length)}
                open={installedOpen || filtering}
                onToggle={() => setInstalledOpen((v) => !v)}
              >
                {installedRows.map((row) =>
                  row.kind === "library" ? (
                    <PluginCard
                      key={`library:${row.plugin.name}`}
                      plugin={row.plugin}
                      category={row.category}
                      installed={installed}
                      onQuickInvoke={quickInvoke}
                      onToggleInstall={toggleInstall}
                      onUpdateOutdated={updateOutdated}
                    />
                  ) : (
                    <ModuleRow
                      key={`module:${row.specifier}`}
                      specifier={row.specifier}
                      entry={row.entry}
                      state={row.state}
                      error={row.error}
                      shipped={row.shipped}
                      busy={pendingSpecifier === row.specifier}
                      blocked={pendingSpecifier !== null && pendingSpecifier !== row.specifier}
                      onInstall={null}
                      onRemove={
                        isAdmin
                          ? () => setPendingApply({ specifier: row.specifier, install: false })
                          : null
                      }
                    />
                  ),
                )}
              </PluginList>
              {availableRows.length > 0 && (
                <PluginList
                  title={S.plugins.availableSection(availableRows.length)}
                  open={availableOpen || filtering}
                  onToggle={() => setAvailableOpen((v) => !v)}
                >
                  {availableRows.map((row) => (
                    <ModuleRow
                      key={`module:${row.specifier}`}
                      specifier={row.specifier}
                      entry={row.entry}
                      state={row.state}
                      shipped={row.shipped}
                      busy={pendingSpecifier === row.specifier}
                      blocked={pendingSpecifier !== null && pendingSpecifier !== row.specifier}
                      onInstall={
                        isAdmin
                          ? () => setPendingApply({ specifier: row.specifier, install: true })
                          : null
                      }
                      onRemove={null}
                    />
                  ))}
                </PluginList>
              )}
              {filtering && installedRows.length === 0 && availableRows.length === 0 && (
                <p className="px-1 text-sm text-gray-400 dark:text-gray-500">{S.plugins.noMatch}</p>
              )}
            </div>
            {/* The filter column: the categories on the page, then two attributes with a
                handful of values each (what a plugin carries, what it is here). Free-form
                keywords are not a facet — they feed the search box. A pick narrows both lists,
                and the lists unfold while anything is picked or typed. */}
            <PluginFilters
              facets={facets}
              picked={picked}
              onCategory={(c) => setPickedCategories((prev) => toggle(prev, c))}
              onKind={(k) => setPickedKinds((prev) => toggle(prev, k))}
              onState={(st) => setPickedStates((prev) => toggle(prev, st))}
              onClear={() => {
                setPickedCategories(new Set());
                setPickedKinds(new Set());
                setPickedStates(new Set());
                setQuery("");
              }}
            />
          </div>
        )}
      </div>

      {/* A module plugin change: what it costs is said before it runs. */}
      {pendingApply !== null && (
        <ConfirmModal
          open
          title={
            pendingApply.install
              ? S.plugins.applyConfirmInstall(pendingApply.specifier)
              : S.plugins.applyConfirmRemove(pendingApply.specifier)
          }
          tone="primary"
          confirmLabel={pendingApply.install ? S.plugins.install : S.plugins.uninstall}
          busy={pendingSpecifier !== null}
          onClose={() => setPendingApply(null)}
          onConfirm={() => void runDeploymentInstall(pendingApply.specifier, pendingApply.install)}
        >
          <p>{S.plugins.applyConfirmBody}</p>
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
    </div>
  );
}

/** One row of the page: a library plugin (skills / hooks, installed per Agent) or a module plugin (listed per Project). */
type PluginRow = { kind: "library"; plugin: PluginItem; category: string } | ModulePluginRow;
interface ModulePluginRow {
  kind: "module";
  specifier: string;
  entry: PluginIndexEntry | undefined;
  state: ModuleState;
  /** Why the process could not load it, when `state` is `failed`. */
  error?: string;
  shipped: boolean;
}
/**
 * What a listed module plugin is here: running; waiting for a runtime that can re-assemble
 * (`pending`); or FAILED — the process tried and could not load it, for the reason the
 * server sends, which no restart would change.
 */
type ModuleState = "none" | "pending" | "active" | "failed";

/**
 * What is installed, in one list: the library's plugins — they ship with the build, so
 * every Agent may use them, and the category their group gave them rides along as a tag —
 * followed by the module plugins this Project asks for, each with its registry entry
 * (description, version, categories) when the registry has one.
 */
export function installedPluginRows(
  groups: readonly PluginGroupItem[],
  locale: Parameters<typeof localizedText>[0],
  deployment: InstalledPluginsResponse | null,
  index: readonly PluginIndexEntry[],
): PluginRow[] {
  const rows: PluginRow[] = [];
  for (const group of groups) {
    const category = localizedText(locale, group.title, group.titleZh);
    for (const plugin of group.plugins) rows.push({ kind: "library", plugin, category });
  }
  for (const listed of deployment?.plugins ?? []) {
    rows.push({
      kind: "module",
      specifier: listed.specifier,
      entry: index.find((e) => e.name === listed.specifier),
      state: listed.active ? "active" : listed.error !== undefined ? "failed" : "pending",
      ...(listed.error !== undefined ? { error: listed.error } : {}),
      shipped: listed.builtin || deployment?.shipped.includes(listed.specifier) === true,
    });
  }
  return rows;
}

/**
 * What could be asked for: the registry's entries this Project does not list yet, and what
 * the build ships that the registry does not know (offered with no description — the build
 * has it, so it is installable without a download).
 */
export function availablePluginRows(
  deployment: InstalledPluginsResponse | null,
  index: readonly PluginIndexEntry[],
): ModulePluginRow[] {
  const listed = new Set((deployment?.plugins ?? []).map((p) => p.specifier));
  const seen = new Set<string>();
  const rows: ModulePluginRow[] = [];
  for (const entry of index) {
    if (listed.has(entry.name) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    rows.push({
      kind: "module",
      specifier: entry.name,
      entry,
      state: "none",
      shipped: deployment?.shipped.includes(entry.name) === true,
    });
  }
  for (const name of deployment?.shipped ?? []) {
    if (listed.has(name) || seen.has(name)) continue;
    seen.add(name);
    rows.push({ kind: "module", specifier: name, entry: undefined, state: "none", shipped: true });
  }
  return rows;
}

/**
 * A titled list of rows: the header bar the library's groups had — the whole row toggles
 * the fold, as on the model page — with one column of cards under it.
 */
function PluginList({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md bg-white dark:bg-gray-900">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 bg-gray-50 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
      >
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <span className="min-w-0 flex-1" />
        <Chevron open={open} className="text-gray-400" />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div
            className={`grid grid-cols-1 gap-2.5 p-2.5 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

/** What a plugin carries: the payload kinds a row is filtered by. */
export type PluginKind = "skills" | "hooks" | "modules";
/** What a plugin is for this deployment. */
export type PluginState = "installed" | "available" | "running" | "restart" | "failed";
export const PLUGIN_KINDS: readonly PluginKind[] = ["skills", "hooks", "modules"];
export const PLUGIN_STATES: readonly PluginState[] = [
  "installed",
  "available",
  "running",
  "restart",
  "failed",
];

/** The category a row belongs to, what it carries and what it is here — the three facets the filter column offers. */
export function rowFacets(row: PluginRow): {
  categories: string[];
  kinds: PluginKind[];
  states: PluginState[];
} {
  if (row.kind === "library") {
    const kinds: PluginKind[] = [];
    if (row.plugin.skills.length > 0) kinds.push("skills");
    if (row.plugin.hooks.length > 0) kinds.push("hooks");
    return { categories: [row.category], kinds, states: ["installed"] };
  }
  const states: PluginState[] =
    row.state === "active"
      ? ["installed", "running"]
      : row.state === "pending"
        ? ["installed", "restart"]
        : row.state === "failed"
          ? ["installed", "failed"]
          : ["available"];
  return { categories: row.entry?.categories ?? [], kinds: ["modules"], states };
}

export interface PluginFacets {
  /** Every category on the page, each once, in first-seen order, with how many rows carry it. */
  categories: { value: string; count: number }[];
  kinds: { value: PluginKind; count: number }[];
  states: { value: PluginState; count: number }[];
}
export interface PickedFacets {
  categories: ReadonlySet<string>;
  kinds: ReadonlySet<PluginKind>;
  states: ReadonlySet<PluginState>;
}

export function pluginFacets(rows: readonly PluginRow[]): PluginFacets {
  const categories = new Map<string, number>();
  const kinds = new Map<PluginKind, number>(PLUGIN_KINDS.map((k) => [k, 0]));
  const states = new Map<PluginState, number>(PLUGIN_STATES.map((st) => [st, 0]));
  for (const row of rows) {
    const f = rowFacets(row);
    for (const c of f.categories) categories.set(c, (categories.get(c) ?? 0) + 1);
    for (const k of f.kinds) kinds.set(k, (kinds.get(k) ?? 0) + 1);
    for (const st of f.states) states.set(st, (states.get(st) ?? 0) + 1);
  }
  const list = <T,>(m: Map<T, number>) =>
    [...m].filter(([, count]) => count > 0).map(([value, count]) => ({ value, count }));
  return { categories: list(categories), kinds: list(kinds), states: list(states) };
}

/**
 * Whether a row survives the search box and the filter column: text anywhere in its name,
 * description or keywords; within a facet any picked value matches, across facets all must.
 */
export function rowMatches(row: PluginRow, query: string, picked: PickedFacets): boolean {
  const f = rowFacets(row);
  if (picked.categories.size > 0 && !f.categories.some((c) => picked.categories.has(c)))
    return false;
  if (picked.kinds.size > 0 && !f.kinds.some((k) => picked.kinds.has(k))) return false;
  if (picked.states.size > 0 && !f.states.some((st) => picked.states.has(st))) return false;
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const text =
    row.kind === "library"
      ? `${row.plugin.name} ${row.plugin.description} ${row.plugin.descriptionZh ?? ""} ${row.plugin.shortDescription ?? ""} ${row.plugin.shortDescriptionZh ?? ""}`
      : `${row.specifier} ${row.entry?.description ?? ""} ${(row.entry?.keywords ?? []).join(" ")}`;
  return text.toLowerCase().includes(q);
}

/**
 * The filter column: three groups, each a vertical list of options with its count — the
 * marketplace sidebar shape. A picked option is filled and carries a check; the heading
 * offers Clear while anything is picked.
 */
function PluginFilters({
  facets,
  picked,
  onCategory,
  onKind,
  onState,
  onClear,
}: {
  facets: PluginFacets;
  picked: PickedFacets;
  onCategory: (category: string) => void;
  onKind: (kind: PluginKind) => void;
  onState: (state: PluginState) => void;
  onClear: () => void;
}) {
  const option = (key: string, label: string, count: number, on: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-150 ${
        on
          ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-700/70 dark:text-gray-100"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/70"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
          on
            ? "border-gray-800 bg-gray-800 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
            : "border-gray-300 dark:border-gray-600"
        }`}
      >
        {on && <GlyphIcon d="M20 6 9 17l-5-5" size={10} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
        {count}
      </span>
    </button>
  );
  const group = (title: string, children: React.ReactNode) => (
    <div>
      <div className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
  const active = picked.categories.size > 0 || picked.kinds.size > 0 || picked.states.size > 0;
  return (
    <aside className="mt-3 space-y-4 md:mt-0 md:sticky md:top-0 md:self-start">
      {/* Always in the flow, hidden until a pick is made: appearing and vanishing would shift
          every option below by a line at the moment of the click. */}
      <button
        type="button"
        onClick={onClear}
        tabIndex={active ? 0 : -1}
        aria-hidden={!active}
        className={`px-2 text-[11px] text-gray-400 underline-offset-2 hover:underline dark:text-gray-500 ${active ? "" : "invisible"}`}
      >
        {S.plugins.filterClear}
      </button>
      {group(
        S.plugins.filterCategories,
        facets.categories.map(({ value, count }) =>
          option(value, value, count, picked.categories.has(value), () => onCategory(value)),
        ),
      )}
      {group(
        S.plugins.filterKind,
        facets.kinds.map(({ value, count }) =>
          option(value, S.plugins.kindLabel[value], count, picked.kinds.has(value), () =>
            onKind(value),
          ),
        ),
      )}
      {group(
        S.plugins.filterState,
        facets.states.map(({ value, count }) =>
          option(value, S.plugins.stateLabel[value], count, picked.states.has(value), () =>
            onState(value),
          ),
        ),
      )}
    </aside>
  );
}

/** One tag on a row's tag line: a category, "built in", a license, a keyword. */
function Tag({
  children,
  mono,
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800 ${mono ? "font-mono text-gray-500 dark:text-gray-400" : "font-medium text-gray-600 dark:text-gray-300"}`}
    >
      {children}
    </span>
  );
}

/** A single plugin card: metadata display (contents badges + a semantic metadata line) + update reminder + quick start + "manage installs" Modal. */
function PluginCard({
  plugin,
  category,
  installed,
  onQuickInvoke,
  onToggleInstall,
  onUpdateOutdated,
}: {
  plugin: PluginItem;
  /** The library's category, shown as the row's first tag (the page has no groups). */
  category: string;
  installed: InstalledMap;
  onQuickInvoke: (skillName: string) => void;
  onToggleInstall: (agentId: string, plugin: PluginItem, on: boolean) => Promise<void>;
  onUpdateOutdated: (name: string, agentIds: string[]) => Promise<void>;
}) {
  const { locale } = useLocale();
  const { agents, currentAgent } = useProject();
  const [installOpen, setInstallOpen] = useState(false);
  // Agents pending an update confirmation (null = none): an update is an overwriting reinstall, so it needs a confirm + a per-agent version list before it runs.
  const [pendingUpdate, setPendingUpdate] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  // Agent pending an uninstall confirmation (null = none): uninstalling deletes the installed files, local edits included.
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

  const confirmUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdating(true);
    await onUpdateOutdated(plugin.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  /** Display name of the Agent pending uninstall (falls back to the raw id below). */
  const uninstallAgent =
    pendingUninstall !== null ? agents.find((a) => a.agentId === pendingUninstall) : undefined;
  const uninstallAgentName = uninstallAgent ? agentDisplayName(uninstallAgent) : undefined;

  let installedCount = 0;
  for (const m of installed.values()) if (pluginInstalled(plugin, m)) installedCount += 1;
  // The server's list of Agents behind on this plugin, minus any this page has since uninstalled
  // it from (the list is re-read after every install action, but the snapshot moves first).
  const outdated = outdatedAgentIds(agents, plugin.name).filter((agentId) =>
    pluginInstalled(plugin, installed.get(agentId)),
  );
  // Quick start opens a draft on the currently selected Agent and pre-selects one of this
  // plugin's skills there, so it's only offered once that Agent has one installed — otherwise
  // it would pre-select a skill the Agent lacks. A plugin with no skill has nothing to start.
  const currentInstalls = currentAgent === null ? undefined : installed.get(currentAgent.agentId);
  const quickStartSkill =
    currentInstalls === undefined
      ? undefined
      : plugin.skills.find((skill) => currentInstalls.skills.has(skill.name));

  // The card's detail Modal (the model library's card pattern): what the plugin ships,
  // with a per-skill SKILL.md reader.
  const [detailOpen, setDetailOpen] = useState(false);
  // Short description takes priority, falling back to the full description
  // when missing (per UI language); title carries the full description for hover reading.
  const description = localizedShortText(locale, plugin);
  const fullDescription = localizedText(locale, plugin.description, plugin.descriptionZh);
  // Metadata line: version (`YYYY.MM.DD.N`, omitted when the manifest carries none, displayed
  // with a `v` in front) · how long ago that version's date is · usage count — plain readable
  // phrases, no badges.
  const versionMatch = /^(\d{4})\.(\d{2})\.(\d{2})\./.exec(plugin.version);
  const versionDate = versionMatch ? versionMatch.slice(1, 4).join("-") : null;
  const meta = [
    plugin.version ? `v${plugin.version}` : null,
    versionDate ? formatRelativeDate(versionDate, locale) : null,
    S.plugins.usedByAgents(installedCount),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return (
    <div className="flex items-center gap-3 rounded-md p-4 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/60">
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        className="min-w-0 flex-1 text-left"
      >
        {/* Header: the plugin icon centered across the two text rows (rounded tile in the plugin's
            own palette color — see SkillTile; deliberately a bit smaller than the two rows),
            with the name and short description on one line each to the right. */}
        <div className="flex items-center gap-3">
          <SkillTile
            icon={plugin.icon}
            name={plugin.name}
            fallback={PLUGIN_ICON}
            size={36}
            glyph={20}
          />
          <div className="min-w-0 flex-1">
            <span
              className="block truncate font-mono text-[13px] font-semibold"
              title={plugin.name}
            >
              {plugin.name}
            </span>
            {/* Short description truncates to one line (full description goes into title for hover reading). */}
            <p
              className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
              title={fullDescription}
            >
              {description}
            </p>
          </div>
        </div>
        {/* Metadata line under the header (e.g. `v2026.08.29.1 · updated 3 days ago · used by
            2 agents`); what the plugin contains lives in the detail Modal this card opens. */}
        <p className="mt-2.5 truncate text-[11px] text-gray-400 dark:text-gray-500" title={meta}>
          {meta}
        </p>
        {/* Tag line: the category, "built in" (the library ships with the build), what it carries. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <Tag>{category}</Tag>
          <Tag title={S.plugins.libraryBuiltinHint}>{S.plugins.builtin}</Tag>
          {plugin.skills.length > 0 && <Tag mono>{S.skills.skillCount(plugin.skills.length)}</Tag>}
          {plugin.hooks.length > 0 && <Tag mono>{S.hooks.hookCount(plugin.hooks.length)}</Tag>}
        </div>
      </button>
      {detailOpen && (
        <PluginDetailModal plugin={plugin} meta={meta} onClose={() => setDetailOpen(false)} />
      )}
      {/* Actions: equal-square light icon buttons in a single row, vertically centered at the
          card's right edge (copy goes into aria-label and title). */}
      <div className="flex shrink-0 items-center justify-center gap-1.5">
        {/* Light (secondary): an update nudge, not the card's primary action. The last stop on
            the plugins trail, so it carries the dot itself — straddling the top-right corner of
            the button's border, the anchoring rule update-dot.tsx states for a button. The mark
            is decorative; what is waiting is already in this button's own title and accessible
            name, which is why no sr-only sentence is added beside it. */}
        {outdated.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="relative h-8 w-8 shrink-0 justify-center p-0"
            aria-label={`${S.plugins.updateOutdated(outdated.length)} ${plugin.name}`}
            title={S.plugins.updateOutdated(outdated.length)}
            onClick={() => setPendingUpdate(outdated)}
          >
            <GlyphIcon d={UPDATE_ICON} size={ICON_SIZE.iconButton} />
            <UpdateDot
              size="inline"
              position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2"
            />
          </Button>
        )}
        {plugin.skills.length > 0 && (
          <Button
            size="sm"
            className="h-8 w-8 shrink-0 justify-center p-0"
            aria-label={`${S.skills.quickInvoke} ${plugin.name}`}
            title={quickStartSkill ? S.skills.quickInvoke : S.plugins.quickInvokeNeedsInstall}
            disabled={quickStartSkill === undefined}
            onClick={() => {
              if (quickStartSkill) onQuickInvoke(quickStartSkill.name);
            }}
          >
            <GlyphIcon d={SEND_ICON} size={ICON_SIZE.iconButton} />
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 w-8 shrink-0 justify-center p-0"
          aria-label={`${S.skills.manageInstall} ${plugin.name}`}
          title={S.skills.manageInstall}
          onClick={() => setInstallOpen(true)}
        >
          <GlyphIcon d={INSTALL_ICON} size={ICON_SIZE.iconButton} />
        </Button>
      </div>
      {installOpen && (
        <Modal
          open
          title={S.skills.manageInstallTitle(plugin.name)}
          onClose={() => setInstallOpen(false)}
        >
          <div className="space-y-0.5">
            {agents.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {agents.map((a) => (
              <InstallRow
                key={a.agentId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                installed={pluginInstalled(plugin, installed.get(a.agentId))}
                outdated={outdated.includes(a.agentId)}
                onToggle={(on) => {
                  // Install runs directly; uninstall deletes the installed files, so it confirms first.
                  if (on) void onToggleInstall(a.agentId, plugin, true);
                  else setPendingUninstall(a.agentId);
                }}
                onUpdate={() => setPendingUpdate([a.agentId])}
              />
            ))}
          </div>
        </Modal>
      )}
      {pendingUpdate && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(plugin.name)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          busy={updating}
          onClose={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.plugins.updateConfirmWarning(plugin.name)}
            </p>
            {/* Per-agent old → new version, so it's clear exactly which installs get overwritten. */}
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingUpdate.map((agentId) => {
                const oldVersion = installedPluginVersion(plugin, installed.get(agentId));
                const target = agents.find((a) => a.agentId === agentId);
                return (
                  <li
                    key={agentId}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {target ? agentDisplayName(target) : agentId}
                    </span>
                    <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">
                      {oldVersion || "?"} → {plugin.version}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>
      )}
      {pendingUninstall !== null && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(plugin.name)}
          confirmLabel={S.skills.uninstall}
          onClose={() => setPendingUninstall(null)}
          onConfirm={() => {
            const agentId = pendingUninstall;
            setPendingUninstall(null);
            void onToggleInstall(agentId, plugin, false);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.uninstallConfirmBody(plugin.name, uninstallAgentName ?? pendingUninstall)}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * One Agent row in the "manage installs" Modal: not-installed shows
 * "Install"; installed shows "Installed", switching to "Uninstall" on hover
 * (same button, click to uninstall); an installed copy the server lists as behind the
 * library additionally shows an accent "Update" button (reinstall = update). Install
 * and uninstall go through optimistic updates (toggleInstall), rolling back on
 * failure.
 */
function InstallRow({
  agentId,
  name,
  installed,
  outdated,
  onToggle,
  onUpdate,
}: {
  agentId: string;
  name: string;
  installed: boolean;
  outdated: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <AgentAvatar id={agentId} name={name} size={22} className="shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate text-sm" title={agentId}>
        {name}
      </span>
      {installed && outdated && (
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          aria-label={`${S.skills.updateAction} ${agentId}`}
          onClick={onUpdate}
        >
          {S.skills.updateAction}
        </Button>
      )}
      {installed ? (
        // group: on hover the button's copy switches "Installed" → "Uninstall" (the same button carries the uninstall action).
        <Button
          size="sm"
          variant="ghost"
          className="group shrink-0"
          aria-label={`${S.skills.uninstall} ${agentId}`}
          onClick={() => onToggle(false)}
        >
          <span className="group-hover:hidden">{S.skills.installed}</span>
          <span className="hidden text-red-600 group-hover:inline dark:text-red-400">
            {S.skills.uninstall}
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0"
          aria-label={`${S.skills.install} ${agentId}`}
          onClick={() => onToggle(true)}
        >
          {S.skills.install}
        </Button>
      )}
    </div>
  );
}

/**
 * A module plugin as a row in the library card's shape: the icon tile, the specifier and
 * version, the description, a metadata line saying what the deployment's own state is (not
 * installed → nothing yet; installed but not loaded → the restart it waits for; running → the
 * modules it holds), then the tag line — its categories, "built in" when this build ships
 * it, the license, the keywords. The trailing cluster is the verb: Install on an available
 * row, Remove on an installed one. The row is a link to the registry page when the registry
 * knows the package; the cluster sits BESIDE that link — a button inside an anchor is invalid
 * markup, and the click would have two meanings.
 */
function ModuleRow({
  specifier,
  entry,
  state,
  error,
  shipped,
  busy,
  blocked,
  onInstall,
  onRemove,
}: {
  specifier: string;
  entry: PluginIndexEntry | undefined;
  state: ModuleState;
  /** Why it failed to load, when it did. */
  error?: string;
  /** The build carries this one: installing it copies nothing over the network. */
  shipped: boolean;
  /** This row's own install or removal is running. */
  busy: boolean;
  /** Another row's is: one at a time, so the rest are held rather than queued. */
  blocked: boolean;
  onInstall: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  const { locale } = useLocale();
  const stateText =
    state === "active"
      ? S.plugins.stateActive
      : state === "pending"
        ? S.plugins.installedRestart
        : state === "failed"
          ? S.plugins.stateFailed
          : S.plugins.notInstalled;
  // Metadata line, the library card's shape: version · updated · what it is here.
  const updated =
    entry?.updatedAt === undefined
      ? null
      : formatRelativeDate(new Date(entry.updatedAt * 1000).toISOString().slice(0, 10), locale);
  const meta = [entry === undefined ? null : `v${entry.version}`, updated]
    .filter((v): v is string => v !== null)
    .join(" · ");
  const body = (
    <>
      <div className="flex items-center gap-3">
        <SkillTile name={specifier} fallback={PLUGIN_ICON} size={36} glyph={20} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="min-w-0 truncate font-mono text-[13px] font-semibold"
              title={`${S.pluginRegistry.specifierHint}: ${specifier}`}
            >
              {specifier}
            </span>
          </div>
          <p
            className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
            title={entry?.description}
          >
            {entry?.description ?? S.plugins.shippedNoEntry}
          </p>
        </div>
      </div>
      <p
        className="mt-2.5 truncate text-[11px] text-gray-400 dark:text-gray-500"
        title={`${meta}${meta === "" ? "" : " · "}${stateText}`}
      >
        {meta !== "" && <span>{meta} · </span>}
        <span
          className={
            state === "active"
              ? toneInk.success
              : state === "pending"
                ? toneInk.attention
                : state === "failed"
                  ? toneInk.danger
                  : undefined
          }
        >
          {stateText}
        </span>
      </p>
      {state === "failed" && error !== undefined && (
        <p className={`mt-1 truncate text-[11px] ${toneInk.danger}`} title={error}>
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {(entry?.categories ?? []).map((category) => (
          <Tag key={category}>{category}</Tag>
        ))}
        {shipped && <Tag title={S.plugins.builtinHint}>{S.plugins.builtin}</Tag>}
        {(entry?.keywords ?? []).map((keyword) => (
          <Tag key={keyword} mono>
            {keyword}
          </Tag>
        ))}
      </div>
    </>
  );
  return (
    <div className="flex items-center gap-3 rounded-md p-4 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/60">
      {entry !== undefined ? (
        <Link to={`/plugins/registry/${specifier}`} className="min-w-0 flex-1">
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      {/* The verb, in the library card's shape: one square light icon button, its copy in
          aria-label and title. While it runs, a spinner stands in for the glyph. */}
      <div className="flex shrink-0 items-center justify-center gap-1.5">
        {state === "none"
          ? onInstall !== null && (
              <Button
                size="sm"
                className="h-8 w-8 shrink-0 justify-center p-0"
                aria-label={`${busy ? S.plugins.installing : S.plugins.install} ${specifier}`}
                aria-busy={busy}
                title={busy ? S.plugins.installing : S.plugins.install}
                disabled={busy || blocked}
                onClick={onInstall}
              >
                {busy ? (
                  <StatusIcon state="running" size={ICON_SIZE.iconButton} />
                ) : (
                  <GlyphIcon d={INSTALL_ICON} size={ICON_SIZE.iconButton} />
                )}
              </Button>
            )
          : onRemove !== null && (
              <Button
                size="sm"
                className="h-8 w-8 shrink-0 justify-center p-0"
                aria-label={`${S.plugins.uninstall} ${specifier}`}
                aria-busy={busy}
                title={S.plugins.uninstall}
                disabled={busy || blocked}
                onClick={onRemove}
              >
                {busy ? (
                  <StatusIcon state="running" size={ICON_SIZE.iconButton} />
                ) : (
                  <GlyphIcon d={TRASH_ICON} size={ICON_SIZE.iconButton} />
                )}
              </Button>
            )}
      </div>
    </div>
  );
}
