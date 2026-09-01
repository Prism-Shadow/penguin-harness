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
import { NAV_ICONS, PLUGIN_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
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
import { formatRelativeDate } from "../../lib/format";
import { SkillTile } from "../skills/skill-icon-view";
import { InfoPopover } from "../../components/ui/info-popover";
import { ICON_SIZE } from "../../lib/icon-scale";

/**
 * What one Agent has installed, by name → the installed copy's version (`YYYY-MM-DD.N`, or ""
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
 * `YYYY-MM-DD.N` strings itself. Not-installed Agents are never listed there.
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
import { InstalledPluginsDialog } from "./installed-dialog";
import { toneInk, toneSurface } from "../../lib/tone";

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

  const [installedOpen, setInstalledOpen] = useState(false);
  /** Bumped when the installed-plugins dialog closes, so the catalogue re-reads what it wrote. */
  const [installedTick, setInstalledTick] = useState(0);
  const [groups, setGroups] = useState<PluginGroupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMap>(new Map());
  /** Collapsed groups (all expanded by default; same convention as the model page's provider groups). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            {S.plugins.pageTitle}
            <InfoPopover label={S.plugins.pageTitle}>{S.plugins.pageDesc}</InfoPopover>
          </h1>
          {/* What this deployment installs and actually runs, as opposed to the library and the
              registry listed below. */}
          <Button variant="secondary" size="sm" onClick={() => setInstalledOpen(true)}>
            <GlyphIcon d={NAV_ICONS.plugins} size={ICON_SIZE.inlineGlyph} />
            {S.plugins.installedTitle}
          </Button>
        </div>
        <InstalledPluginsDialog
          open={installedOpen}
          onClose={() => {
            setInstalledOpen(false);
            setInstalledTick((n) => n + 1);
          }}
          isAdmin={user?.isAdmin === true}
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

        {error ? (
          <div className="mt-6 flex items-center gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" onClick={() => window.location.reload()}>
              {S.common.retry}
            </Button>
          </div>
        ) : groups === null ? (
          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} className="p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-6 w-36" />
              </SkeletonCard>
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {groups.map((group) => {
              const open = !collapsed.has(group.id);
              return (
                <section
                  key={group.id}
                  className="overflow-hidden rounded-md bg-white dark:bg-gray-900"
                >
                  {/* Group header (styled like the model page's provider groups): category name +
                      plugin count (no icon, no description); the whole row toggles
                      collapse on click and highlights on hover. */}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2.5 bg-gray-50 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
                  >
                    {/* Group name can truncate (min-w-0): the count and collapse arrow must not shrink. */}
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {localizedText(locale, group.title, group.titleZh)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">
                      {S.plugins.pluginCount(group.plugins.length)}
                    </span>
                    <span className="min-w-0 flex-1" />
                    <Chevron open={open} className="text-gray-400" />
                  </button>

                  {/* Expand/collapse height transition: grid-template-rows tweens between
                      0fr and 1fr, with the inner overflow-hidden clipping the content
                      (same convention as the model page). */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    {/* inert while collapsed: cards at zero height shouldn't still be Tab-focusable or clickable. */}
                    <div className="overflow-hidden" inert={!open}>
                      {/* Generously sized cards: 2 columns ≥sm, 1 column on narrow screens.
                          `grid-cols-1` is load-bearing, not redundant: with no declared track the
                          single implicit column is `auto`-sized, and an auto track never goes below
                          the widest card's min-content width — which `truncate` does not lower,
                          since `nowrap` leaves no wrap opportunity and `overflow: hidden` only
                          clips at paint time. A card then overflows the section's `overflow-hidden`
                          and its action buttons land off-viewport, unreachable. Tailwind's
                          `grid-cols-*` is `minmax(0, 1fr)`, which clamps that floor to 0. */}
                      <div
                        className={`grid grid-cols-1 gap-2.5 p-2.5 transition-opacity duration-200 sm:grid-cols-2 ${open ? "opacity-100" : "opacity-0"}`}
                      >
                        {group.plugins.map((plugin) => (
                          <PluginCard
                            key={plugin.name}
                            plugin={plugin}
                            installed={installed}
                            onQuickInvoke={quickInvoke}
                            onToggleInstall={toggleInstall}
                            onUpdateOutdated={updateOutdated}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

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
      <RegistrySection isAdmin={user?.isAdmin === true} installedTick={installedTick} />
    </div>
  );
}

/** A single plugin card: metadata display (contents badges + a semantic metadata line) + update reminder + quick start + "manage installs" Modal. */
function PluginCard({
  plugin,
  installed,
  onQuickInvoke,
  onToggleInstall,
  onUpdateOutdated,
}: {
  plugin: PluginItem;
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
  // Metadata line: version (`YYYY-MM-DD.N`, omitted when the manifest carries none) · how
  // long ago that version's date is · usage count — plain readable phrases, no badges.
  const versionDate = plugin.version ? plugin.version.split(".")[0]! : null;
  const meta = [
    plugin.version ? `v${plugin.version}` : null,
    versionDate ? formatRelativeDate(versionDate, locale) : null,
    S.plugins.usedByAgents(installedCount),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return (
    <div className="flex h-full items-center gap-3 rounded-md p-4 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/60">
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
        {/* Metadata line under the header (e.g. `v2026-08-29.1 · updated 3 days ago · used by
            2 agents`); what the plugin contains lives in the detail Modal this card opens. */}
        <p className="mt-2.5 truncate text-[11px] text-gray-400 dark:text-gray-500" title={meta}>
          {meta}
        </p>
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
 * The registry section: what this deployment's plugin index lists (GET
 * /api/plugins/registry), below the library this build ships. One column because the entry
 * that identifies a plugin is its package specifier — long, scoped and monospace, which
 * side-by-side columns would truncate exactly where an operator reads.
 *
 * Read-only discovery: installing an indexed plugin is an install-side operation
 * (plugins.json under the data root), not a Web App one.
 */
function RegistrySection({ isAdmin, installedTick }: { isAdmin: boolean; installedTick: number }) {
  const [plugins, setPlugins] = useState<PluginIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What this deployment installs, so a catalogue row can say what it is for this server. */
  const [installed, setInstalled] = useState<InstalledPluginsResponse | null>(null);
  /** The row whose install or removal is running: npm is one at a time. */
  const [pendingSpecifier, setPendingSpecifier] = useState<string | null>(null);

  const reloadInstalled = useCallback(() => {
    api.getInstalledPlugins().then(setInstalled, () => setInstalled(null));
  }, []);
  useEffect(reloadInstalled, [reloadInstalled, installedTick]);

  /**
   * Installs the package into the data root and then lists it — writing the list alone would
   * name a package that is not on the machine, which is exactly the state the row would then
   * have to report as broken. The running process is untouched until it restarts.
   */
  const runInstall = async (specifier: string, install: boolean) => {
    if (pendingSpecifier !== null) return;
    setPendingSpecifier(specifier);
    try {
      setInstalled(
        install ? await api.installPlugin(specifier) : await api.uninstallPlugin(specifier),
      );
      toastSuccess(install ? S.plugins.deploymentInstalledToast(specifier) : S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setPendingSpecifier(null);
    }
  };
  const specifiers = (installed?.plugins ?? []).map((p) => p.specifier);
  const stateOf = (name: string): "none" | "pending" | "active" => {
    const row = installed?.plugins.find((p) => p.specifier === name);
    return row === undefined ? "none" : row.active ? "active" : "pending";
  };
  /**
   * Sources that answered with nothing. A published index that is down shortens this listing
   * instead of emptying it (the server merges tolerantly), so the section has to say so — a
   * silently shorter list reads as "that plugin does not exist".
   */
  const [failures, setFailures] = useState<{ source: string; error: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getPluginIndex()
      .then((res) => {
        if (cancelled) return;
        setPlugins(res.plugins);
        setFailures(res.failures ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">{S.pluginRegistry.pageTitle}</h2>
      {failures.length > 0 && (
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${toneSurface.attention}`}>
          {S.pluginRegistry.sourceUnavailable(failures.length)}
        </div>
      )}
      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : plugins === null ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCard key={i} className="p-4">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </SkeletonCard>
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">{S.pluginRegistry.empty}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {plugins.map((plugin) => (
            // Versions are distinct index entries (typst-style flat index), so the key needs both halves.
            <RegistryRow
              key={`${plugin.name}@${plugin.version}`}
              plugin={plugin}
              state={stateOf(plugin.name)}
              busy={pendingSpecifier === plugin.name}
              blocked={pendingSpecifier !== null && pendingSpecifier !== plugin.name}
              onInstall={isAdmin ? () => void runInstall(plugin.name, true) : null}
              onRemove={isAdmin ? () => void runInstall(plugin.name, false) : null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One index entry as a row: icon tile, specifier/version and description, a license +
 * keywords metadata line, and a trailing cluster where a list row's chevron would sit — the
 * app-store shape, so the action reads at a glance instead of riding a full-width footer bar.
 * The row itself is the link — a plugin has one destination — and the cluster sits BESIDE
 * that link rather than inside it: a button nested in an anchor is invalid markup, and the
 * click would have two meanings.
 *
 * The cluster says what the deployment's own state is, not what the catalogue holds: not
 * installed → an Install pill, installed but not loaded → the restart it waits for, running →
 * a success chip; Remove is the quiet text action under a chip. Installing writes
 * plugins.json; it does not load anything (see installed-dialog).
 */
function RegistryRow({
  plugin,
  state,
  busy,
  blocked,
  onInstall,
  onRemove,
}: {
  plugin: PluginIndexEntry;
  state: "none" | "pending" | "active";
  /** This row's own install or removal is running. */
  busy: boolean;
  /** Another row's is: one npm at a time, so the rest are held rather than queued. */
  blocked: boolean;
  onInstall: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  const chip =
    state === "active" ? (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneSurface.success}`}>
        {S.plugins.stateActive}
      </span>
    ) : state === "pending" ? (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${toneSurface.attention}`}>
        {S.plugins.installedRestart}
      </span>
    ) : null;
  return (
    <div className="flex items-stretch rounded-md border border-gray-200 bg-white transition-colors duration-150 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      <Link
        to={`/plugins/registry/${plugin.name}`}
        className="min-w-0 flex-1 rounded-l-md p-4 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            <GlyphIcon d={NAV_ICONS.plugins} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className="min-w-0 truncate font-mono text-[13px] font-semibold"
                title={`${S.pluginRegistry.specifierHint}: ${plugin.name}`}
              >
                {plugin.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-gray-400">v{plugin.version}</span>
            </div>
            <p
              className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
              title={plugin.description}
            >
              {plugin.description}
            </p>
          </div>
          {chip === null && onInstall === null && (
            <GlyphIcon
              d="M9 6l6 6-6 6"
              size={14}
              className="shrink-0 text-gray-300 dark:text-gray-600"
            />
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-gray-400 dark:text-gray-500">{plugin.license}</span>
          {(plugin.keywords ?? []).map((keyword) => (
            <span
              key={keyword}
              className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            >
              {keyword}
            </span>
          ))}
        </div>
      </Link>
      {(chip !== null || onInstall !== null) && (
        <div className="flex shrink-0 flex-col items-end justify-center gap-1 py-3 pr-4 pl-1">
          {state === "none"
            ? onInstall !== null && (
                <Button variant="primary" size="sm" disabled={busy || blocked} onClick={onInstall}>
                  {busy ? S.plugins.installing : S.plugins.install}
                </Button>
              )
            : chip}
          {state !== "none" && onRemove !== null && (
            <button
              type="button"
              disabled={busy || blocked}
              onClick={onRemove}
              className="text-[11px] text-gray-400 underline-offset-2 transition-colors duration-150 hover:text-red-600 hover:underline disabled:opacity-60 dark:text-gray-500 dark:hover:text-red-400"
            >
              {S.plugins.uninstall}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
