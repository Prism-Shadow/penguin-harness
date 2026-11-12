/**
 * Agent settings page "Plugins" tab: what the Agent carries, in four sub-pages switched under the
 * tab strip by one segmented control, each named in the address (`?tab=plugins|skills|hooks|
 * workbenches`, plugins-subpages.ts):
 *
 * - **Plugins** (agent-plugins-page.tsx): the Agent's plugins and the ones the library could still
 *   give it, as the Plugins page's cards — install and update for any member, uninstall for the
 *   Project owner — with a search box and "Open the Plugins page", which opens that page with this
 *   Agent as the current one. A plugin's detail is addressable (`&plugin=<name>`).
 * - **Skills**: "Enable skills", the alert under it, every Skill on the Agent, then the skills
 *   prompt it governs.
 * - **Hooks**: "Enable hooks", and every hook package.
 * - **Workbenches**: "Enable workbenches", the Agent-wide switch over every workbench's own, and
 *   every workbench.
 *
 * The three kind sub-pages are flat lists: a plugin's parts and the user's own side by side, each
 * part a plugin installed marked after its name with the puzzle that names the plugin and opens
 * its detail (agent-skills.tsx, agent-hooks.tsx, agent-workbenches.tsx). Each has its own Import
 * at the bar's end. The switches are written at once and are the Project owner's alone (a member
 * sees their state). MCP servers have no sub-page: a plugin's are listed in its detail, and they
 * are edited on the Tools tab.
 *
 * The bar and the fold under it are drawn in every state of the page, so nothing in them moves
 * when an answer lands. One read serves all four sub-pages: the Agent's plugin lists, its
 * workbenches, its config (for the switches) and the library of the server it lives on. Switching
 * sub-page reads nothing again; every change reads them again rather than patching them, and the
 * lists on screen stay until the new ones land. The answers are handed to the Plugins page's
 * stores too (agent-installs.ts, plugin-reads.ts), so that page shows the same thing next.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  AgentPluginsInstallResponse,
  PluginGroupItem,
  WorkbenchInfo,
  WorkbenchesResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  HelpFold,
  NoticeStrip,
  SearchInput,
  SettingsList,
  SubPageBar,
  ToggleRow,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { useAgentLocation } from "../../lib/agent-location";
import { useInstantSetting } from "../../lib/instant-setting";
import {
  publishMachineAgentsChanged,
  readMachineAgents,
  useAgentsOn,
} from "../../lib/machine-agent-lists";
import { S } from "../../lib/strings";
import { WORKBENCH_UPDATED_EVENT } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useMachines } from "../../state/machines";
import { agentDisplayName, useProject } from "../../state/project";
import {
  LIBRARY_KEY,
  agentInstalls,
  agentPluginGroups,
  installsKey,
  pluginLibrary,
  type AgentPluginGroups,
} from "../plugins";
import { agentPluginTitle } from "./agent-plugin-actions";
import { AgentPluginsPage } from "./agent-plugins-page";
import { HookImportDialog, useHookRows } from "./agent-hooks";
import { SkillImportDialog, useSkillRows } from "./agent-skills";
import { WorkbenchImportDialog, useWorkbenchRows } from "./agent-workbenches";
import {
  PLUGINS_SUBPAGES,
  PLUGIN_PARAM,
  type PartSource,
  type PluginsSubPage,
} from "./plugins-subpages";
import { usePromptInjection } from "./prompt-injection-controls";

/** Everything the sub-pages list, as the Agent's server last answered. */
interface Lists {
  installed: AgentPluginsInstallResponse;
  workbenches: WorkbenchesResponse;
  /** The library by category: the Plugins sub-page's tags name them. */
  library: PluginGroupItem[];
}

/** Which import dialog is open. */
type ImportKind = "skill" | "hook" | "workbench";

/** The plugin each part came from, by kind, keyed as the rows look them up. */
interface Sources {
  skills: ReadonlyMap<string, PartSource>;
  hooks: ReadonlyMap<string, PartSource>;
  workbenches: ReadonlyMap<string, PartSource>;
}

const NO_SOURCES: Sources = { skills: new Map(), hooks: new Map(), workbenches: new Map() };

export function PluginsTab({
  agentId,
  subPage,
  onSubPage,
  onConfigChanged,
}: {
  agentId: string;
  /** The sub-page the address names. */
  subPage: PluginsSubPage;
  /** Writes the sub-page (or the Tools tab) into `?tab=`: the settings page's tab switch. */
  onSubPage: (next: PluginsSubPage | "tools") => void;
  /** The switches and the prompt write the Agent config directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentProject, reloadAgents, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  /** The machine the Agent lives on (null: this server), and the Agents that server runs. */
  const machineId = useAgentLocation();
  const agent = useAgentsOn(machineId).find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;
  const machines = useMachines();
  /** The machine's ssh alias, where a stdio server's command would run; undefined here. */
  const machineLabel =
    machineId === null
      ? undefined
      : (machines.state?.machines.find((m) => !m.local && m.machineId === machineId)?.alias ??
        machineId);

  const skillsSwitch = usePromptInjection({
    agentId,
    feature: "skills",
    strings: S.skills.injection,
    canEdit: isOwner,
    onConfigChanged,
  });
  const hooksSwitch = usePromptInjection({
    agentId,
    feature: "hooks",
    strings: S.hooks.injection,
    canEdit: isOwner,
    onConfigChanged,
  });
  const applySkills = skillsSwitch.applyConfig;
  const applyHooks = hooksSwitch.applyConfig;

  const [lists, setLists] = useState<Lists | null>(null);
  // Only a read that failed with nothing to show renders inline; actions report in toasts.
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<ImportKind | null>(null);
  /** The Plugins sub-page's search: what is on screen, narrowed; not remembered. */
  const [query, setQuery] = useState("");

  /** The newest read: an answer to an older one is not taken. */
  const asked = useRef(0);
  const load = useCallback(async () => {
    if (!projectId) return;
    const mine = ++asked.current;
    try {
      const [installed, workbenches, config, library] = await Promise.all([
        api.getAgentPlugins(projectId, agentId, machineId),
        api.getWorkbenches(projectId, agentId, machineId),
        api.getAgentConfig(projectId, agentId, machineId),
        api.getPluginLibrary(machineId),
      ]);
      if (asked.current !== mine) return;
      applySkills(config.config);
      applyHooks(config.config);
      agentInstalls.accept(installsKey(projectId, machineId, agentId), installed);
      // The Plugins page reads this server's library alone.
      if (machineId === null) pluginLibrary.accept(LIBRARY_KEY, library);
      setLists({ installed, workbenches, library: library.groups });
      setError(null);
    } catch (e) {
      if (asked.current === mine) setError(apiErrorText(e));
    }
  }, [projectId, agentId, machineId, applySkills, applyHooks]);

  useEffect(() => {
    void load();
    // A workbench reloaded or removed elsewhere (the Agent editing its own, a tab beside a chat).
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; agentId: string }>).detail;
      if (detail.projectId === projectId && detail.agentId === agentId) void load();
    };
    window.addEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    return () => {
      asked.current++;
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, onUpdated);
    };
  }, [load, projectId, agentId]);

  /**
   * After a change: the lists again, and the Agent list whose counts and update marks moved — a
   * machine's from that machine.
   */
  const changed = useCallback(async () => {
    await load();
    if (!projectId) return;
    if (machineId === null) {
      void reloadAgents().catch(() => undefined);
    } else {
      publishMachineAgentsChanged(machineId);
      void readMachineAgents(projectId, machineId).catch(() => undefined);
    }
  }, [load, projectId, machineId, reloadAgents]);

  const catalog: AgentPluginGroups | null =
    lists === null
      ? null
      : agentPluginGroups(
          lists.library,
          lists.installed,
          lists.workbenches.workbenches,
          agent?.pluginUpdates ?? [],
        );

  /** Which plugin each part came from, for the rows' marks and their removals' notes. */
  const sources: Sources = (() => {
    if (catalog === null) return NO_SOURCES;
    const skills = new Map<string, PartSource>();
    const hooks = new Map<string, PartSource>();
    const workbenches = new Map<string, PartSource>();
    for (const group of catalog.groups) {
      const source: PartSource = {
        name: group.name,
        title: agentPluginTitle(group, locale),
        ...(group.plugin?.icon !== undefined ? { icon: group.plugin.icon } : {}),
      };
      for (const skill of group.parts.skills) skills.set(skill.name, source);
      for (const hook of group.parts.hooks) hooks.set(hook.name, source);
      for (const workbench of group.parts.workbenches) workbenches.set(workbench.id, source);
    }
    return { skills, hooks, workbenches };
  })();

  /** The plugin whose detail the address names on the Plugins sub-page. */
  const openName = subPage === "plugins" ? searchParams.get(PLUGIN_PARAM) : null;
  /** Opens a plugin's detail: the Plugins sub-page, with the plugin in the address. */
  const openPlugin = useCallback(
    (name: string) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", "plugins");
          next.set(PLUGIN_PARAM, name);
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const closePlugin = useCallback(
    () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(PLUGIN_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  // An address naming a plugin the page does not list opens nothing, and keeps nothing of it.
  const named = searchParams.get(PLUGIN_PARAM);
  const listed =
    catalog === null || named === null
      ? true
      : [...catalog.groups, ...catalog.available].some((entry) => entry.name === named);
  useEffect(() => {
    if (!listed) closePlugin();
  }, [listed, closePlugin]);

  const skillRows = useSkillRows({
    agentId,
    agentName,
    onChanged: changed,
    sourceOf: (name) => sources.skills.get(name),
    onOpenPlugin: openPlugin,
  });
  const hookRows = useHookRows({
    agentId,
    agentName,
    onChanged: changed,
    sourceOf: (name) => sources.hooks.get(name),
    onOpenPlugin: openPlugin,
  });
  const allEnabled = lists?.workbenches.enabled;
  const workbenchRows = useWorkbenchRows({
    agentId,
    onChanged: changed,
    onSwitched: (workbench: WorkbenchInfo) =>
      setLists((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              workbenches: {
                ...prev.workbenches,
                workbenches: prev.workbenches.workbenches.map((w) =>
                  w.id === workbench.id ? workbench : w,
                ),
              },
            },
      ),
    allEnabled,
    canSwitch: isOwner,
    sourceOf: (id) => sources.workbenches.get(id),
    onOpenPlugin: openPlugin,
  });

  /** The Agent-wide workbench switch: written alone, its answer the whole list. */
  const workbenchesSwitch = useInstantSetting(allEnabled ?? true, async (enabled: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchesEnabled(projectId, agentId, enabled, machineId);
    setLists((prev) => (prev === null ? prev : { ...prev, workbenches: res }));
  });

  if (!projectId) return null;

  const loading = lists === null && error === null;
  /** A sub-page's Import: the dialog of its kind, once the lists are in. */
  const importButton = (kind: ImportKind, label: string) => (
    <Button
      size="sm"
      variant="primary"
      disabled={lists === null}
      onClick={() => setImporting(kind)}
    >
      {label}
    </Button>
  );
  const barActions: Record<PluginsSubPage, ReactNode> = {
    plugins: (
      <>
        <div className="w-full sm:w-48">
          <SearchInput
            size="sm"
            value={query}
            placeholder={S.plugins.searchPlaceholder}
            aria-label={S.plugins.searchPlaceholder}
            onChange={setQuery}
          />
        </div>
        <Button
          size="sm"
          onClick={() => {
            // The Plugins page's current Agent is one of this server's; a machine's never is.
            if (machineId === null) setCurrentAgentId(agentId);
            void navigate("/plugins");
          }}
        >
          {S.agentPlugins.openMarket}
        </Button>
      </>
    ),
    skills: importButton("skill", S.skills.importSkill),
    hooks: importButton("hook", S.hooks.importHook),
    workbenches: importButton("workbench", S.workbenches.importTitle),
  };

  /** Each kind sub-page: its switch in a card of its own, then its rows, every one of them. */
  const body: Record<PluginsSubPage, () => ReactNode> = {
    plugins: () => (
      <AgentPluginsPage
        target={{ projectId, agentId, machineId }}
        agentName={agentName}
        machineLabel={machineLabel}
        isOwner={isOwner}
        locale={locale}
        library={lists?.library ?? null}
        installed={lists?.installed ?? null}
        catalog={catalog}
        query={query}
        openName={openName}
        onOpen={openPlugin}
        onClose={closePlugin}
        onManage={onSubPage}
        onChanged={changed}
        onReload={() => void load()}
      />
    ),
    skills: () => (
      <>
        {skillsSwitch.toggleCard}
        {skillsSwitch.alertStrip}
        <SettingsList
          label={S.agentPlugins.subPages.skills}
          loading={loading}
          empty={S.agentPlugins.skillsEmpty}
        >
          {lists?.installed.skills.map(skillRows.row)}
        </SettingsList>
        {skillsSwitch.promptSection}
      </>
    ),
    hooks: () => (
      <>
        {hooksSwitch.toggleCard}
        <SettingsList
          label={S.agentPlugins.subPages.hooks}
          loading={loading}
          empty={S.agentPlugins.hooksEmpty}
        >
          {lists?.installed.hooks.map(hookRows.row)}
        </SettingsList>
      </>
    ),
    workbenches: () => (
      <>
        {/* A server older than the switches says nothing about them, and gets none. */}
        {allEnabled !== undefined && (
          <ToggleRow
            variant="card"
            label={S.workbenches.enableAll}
            info={S.workbenches.enableAllHint}
            checked={workbenchesSwitch.value}
            disabled={workbenchesSwitch.busy || !isOwner}
            onChange={(next) => void workbenchesSwitch.set(next)}
          />
        )}
        <SettingsList
          label={S.agentPlugins.subPages.workbenches}
          loading={loading}
          empty={S.agentPlugins.workbenchesEmpty}
        >
          {lists?.workbenches.workbenches.map(workbenchRows.row)}
        </SettingsList>
      </>
    ),
  };

  return (
    <div className="space-y-4">
      <SubPageBar
        label={S.agentPlugins.subNav}
        items={PLUGINS_SUBPAGES.map((key) => ({ key, label: S.agentPlugins.subPages[key] }))}
        active={subPage}
        onChange={(next) => {
          if (next !== subPage) onSubPage(next);
        }}
        actions={barActions[subPage]}
      />
      {/* The sub-page's description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agentPlugins.subPages[subPage]}>
        {S.agentPlugins.desc[subPage]}
        {!isOwner && <span className="mt-1.5 block">{S.agentPlugins.readOnly[subPage]}</span>}
      </HelpFold>

      {lists === null && error !== null && (
        <NoticeStrip tone="danger">
          {error}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </NoticeStrip>
      )}

      {!(lists === null && error !== null) && body[subPage]()}

      {skillRows.modals}
      {hookRows.modals}
      {workbenchRows.modals}

      {importing === "skill" && (
        <SkillImportDialog
          projectId={projectId}
          agentId={agentId}
          onClose={() => setImporting(null)}
          onImported={() => {
            setImporting(null);
            toastSuccess(`${S.skills.importDoneToast}${S.agent.takesEffectSuffix}`);
            void changed();
          }}
        />
      )}
      {importing === "hook" && (
        <HookImportDialog
          projectId={projectId}
          agentId={agentId}
          onClose={() => setImporting(null)}
          onImported={() => {
            setImporting(null);
            toastSuccess(S.hooks.importDoneToast);
            void changed();
          }}
        />
      )}
      {importing === "workbench" && (
        <WorkbenchImportDialog
          projectId={projectId}
          agentId={agentId}
          machineId={machineId}
          onClose={() => setImporting(null)}
          onImported={(workbench) => {
            setImporting(null);
            // Its files are written either way; a load that failed says so instead of a success.
            if (workbench.error === null) toastSuccess(S.workbenches.importDoneToast);
            else toastError(S.workbenches.importLoadFailedToast(workbench.error));
            void changed();
          }}
        />
      )}
    </div>
  );
}
