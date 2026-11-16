/**
 * Agent settings page "Plugins" tab: what is installed on the Agent, by the plugin it came from
 * (features/plugins/agent-plugin-groups.ts has the rules), top to bottom —
 *
 * - the header: "Import" (a Skill, a hook package or a workbench, each through its own dialog)
 *   and "Browse plugin library", which opens the Plugins page with this Agent as the current one;
 * - the switches, written at once and the Project owner's alone (a member sees their state):
 *   "Enable skills" with the skills prompt it governs, "Enable hooks", and "Enable workbenches",
 *   the Agent-wide switch over every workbench's own;
 * - the installed plugins, one folded row each: its icon, title, status and what it brought
 *   ("3 skills, hooks, 1 workbench"), then "Update" while it is behind the library or missing a
 *   part, and the owner's "Uninstall". Unfolded, its parts in the rows each kind has
 *   (agent-skills.tsx, agent-hooks.tsx, agent-workbenches.tsx); an MCP server only by name and
 *   what it waits for, since it is edited on the Tools tab;
 * - last, what belongs to no plugin: the Skills, hook packages and workbenches the user made or
 *   imported.
 *
 * Uninstalling a plugin is one request: the server removes every part and answers what it
 * removed and what it could not. The confirmation lists the parts first, and warns that a
 * workbench's data and versions go with it — its switch is the way to stop using one and keep
 * them. A machine older than that request answers it with a plain 404, which reads as the machine
 * needing an update; a machine older than the workbench switches lists no switch to show.
 *
 * The lists are files on the Agent's server, so after every change they are read again rather
 * than patched: the Agent's plugin lists, its workbenches, its config (for the switches) and the
 * library of the server it lives on. The plugin lists answered here are handed to the Plugins
 * page's store too (agent-installs.ts), so that page shows the same thing next.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  AgentPluginsInstallResponse,
  IconRef,
  PluginItem,
  WorkbenchInfo,
  WorkbenchesResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Card,
  ChevronDown,
  CollapsibleSection,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  HelpFold,
  ICONS,
  ICON_SIZE,
  IconButton,
  ListRow,
  Menu,
  MenuItem,
  NoticeStrip,
  Pill,
  SettingsEmpty,
  SettingsGroup,
  SettingsList,
  SkeletonList,
  ToggleRow,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { useAgentLocation } from "../../lib/agent-location";
import { useInstantSetting } from "../../lib/instant-setting";
import {
  publishMachineAgentsChanged,
  readMachineAgents,
  useAgentsOn,
} from "../../lib/machine-agent-lists";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { WORKBENCH_UPDATED_EVENT } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { BOOK_ICON, localizedText } from "../../lib/skill-use";
import {
  StdioDisclosure,
  agentInstalls,
  agentPluginGroups,
  hasParts,
  installsKey,
  type AgentPluginGroup,
  type AgentPluginStatus,
} from "../plugins";
import { SkillTile } from "../skills";
import { HookImportDialog, useHookRows } from "./agent-hooks";
import { SkillImportDialog, useSkillRows } from "./agent-skills";
import { WorkbenchImportDialog, useWorkbenchRows } from "./agent-workbenches";
import { usePromptInjection } from "./prompt-injection-controls";

/** Everything the tab lists, as the Agent's server last answered. */
interface Lists {
  installed: AgentPluginsInstallResponse;
  workbenches: WorkbenchesResponse;
  library: PluginItem[];
}

/** What a plugin's status means, as a tone: settled well, unfinished, or receding. */
const STATUS_TONE: Record<AgentPluginStatus, ToneName> = {
  installed: "success",
  update: "attention",
  incomplete: "attention",
  "not-in-library": "neutral",
};

/** Which import dialog is open. */
type ImportKind = "skill" | "hook" | "workbench";

export function PluginsTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** The switches and the prompt write the Agent config directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { currentProject, reloadAgents, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  /** The machine the Agent lives on (null: this server), and the Agents that server runs. */
  const machineId = useAgentLocation();
  const agent = useAgentsOn(machineId).find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;

  const skillsSwitch = usePromptInjection({
    agentId,
    feature: "skills",
    strings: S.skills.injection,
    canEdit: isOwner,
    toggleVariant: "row",
    onConfigChanged,
  });
  const hooksSwitch = usePromptInjection({
    agentId,
    feature: "hooks",
    strings: S.hooks.injection,
    canEdit: isOwner,
    toggleVariant: "row",
    onConfigChanged,
  });
  const applySkills = skillsSwitch.applyConfig;
  const applyHooks = hooksSwitch.applyConfig;

  const [lists, setLists] = useState<Lists | null>(null);
  // Only a read that failed with nothing to show renders inline; actions report in toasts.
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<ImportKind | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  /** The plugin whose Update or Uninstall waits for its confirmation. */
  const [pending, setPending] = useState<{
    group: AgentPluginGroup;
    verb: "update" | "uninstall";
  } | null>(null);
  const [running, setRunning] = useState(false);

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
      setLists({
        installed,
        workbenches,
        library: library.groups.flatMap((group) => group.plugins),
      });
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

  const skillRows = useSkillRows({ agentId, agentName, onChanged: changed });
  const hookRows = useHookRows({ agentId, agentName, onChanged: changed });
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
  });

  /** The Agent-wide workbench switch: written alone, its answer the whole list. */
  const workbenchesSwitch = useInstantSetting(allEnabled ?? true, async (enabled: boolean) => {
    if (!projectId) return;
    const res = await api.setWorkbenchesEnabled(projectId, agentId, enabled, machineId);
    setLists((prev) => (prev === null ? prev : { ...prev, workbenches: res }));
  });

  /** Update: the library's copy installed again over the Agent's, which puts back a missing part too. */
  const runUpdate = async (group: AgentPluginGroup, title: string) => {
    if (!projectId) return;
    setRunning(true);
    try {
      const res = await api.installAgentPlugins(projectId, agentId, [group.name], machineId);
      agentInstalls.accept(installsKey(projectId, machineId, agentId), res);
      toastSuccess(`${S.agentPlugins.updatedToast(title, agentName)}${S.agent.takesEffectSuffix}`);
      setPending(null);
      await changed();
    } catch (e) {
      toastApiError(e);
    } finally {
      setRunning(false);
    }
  };

  /**
   * Uninstall: one request, the server removing every part. A part it could not remove is named
   * with why, the rest are gone either way. Nothing left to remove is no failure: the lists read
   * again show it. A 404 of any other kind is a machine older than the request.
   */
  const uninstallPlugin = async (group: AgentPluginGroup, title: string) => {
    if (!projectId) return;
    setRunning(true);
    try {
      const res = await api.uninstallAgentPlugin(projectId, agentId, group.name, machineId);
      const failed = res.failed ?? [];
      if (failed.length > 0) {
        const named = failed.map((f) => S.agentPlugins.failedPart(f.name, f.error));
        toastError(S.agentPlugins.uninstallPartly(title, named.join(S.todo.listSeparator)));
      } else {
        toastSuccess(`${S.plugins.uninstalledToast(title, agentName)}${S.agent.takesEffectSuffix}`);
      }
    } catch (e) {
      const notFound = e instanceof ApiError && e.status === 404;
      const nothingLeft = notFound && e instanceof ApiError && e.code === "plugin_not_installed";
      // Nothing left to remove is what was asked for; the lists read again below show it.
      if (!nothingLeft) {
        // Any other 404 is a server without the request: a machine older than this page.
        if (notFound && machineId !== null) toastError(S.errors.byCode.machine_outdated);
        else toastApiError(e);
        setRunning(false);
        return;
      }
    }
    setPending(null);
    setRunning(false);
    await changed();
  };

  if (!projectId) return null;

  const { groups, own } =
    lists === null
      ? { groups: [], own: null }
      : agentPluginGroups(
          lists.library,
          lists.installed,
          lists.workbenches.workbenches,
          agent?.pluginUpdates ?? [],
        );
  const titleOf = (group: AgentPluginGroup) =>
    group.plugin === null
      ? group.name
      : localizedText(locale, group.plugin.title || group.name, group.plugin.titleZh);

  /** An MCP server a plugin installed: its name and what it waits for; edited on the Tools tab. */
  const mcpRow = (server: AgentPluginGroup["parts"]["mcpServers"][number], icon?: IconRef) => (
    <ListRow
      key={`mcp:${server.name}`}
      as="li"
      leading={<SkillTile icon={icon} name={server.name} fallback={ICONS.plug} />}
      title={
        <span className="font-mono text-[length:var(--ui-text-code-size)] font-semibold">
          {server.name}
        </span>
      }
      description={server.target}
      trailing={
        <>
          {server.missingKeys.length > 0 && (
            <Pill
              tone="attention"
              tooltip={`${S.plugins.mcpNeedsSetup(server.missingKeys)}, ${isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}`}
            >
              {S.agentPlugins.mcpNeedsSetup}
            </Pill>
          )}
          {server.signIn && (
            <Pill tone="attention" tooltip={S.plugins.mcpSignIn}>
              {S.agentPlugins.mcpNeedsSignIn}
            </Pill>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set("tab", "tools");
                  return next;
                },
                { replace: true },
              )
            }
          >
            {S.agentPlugins.mcpEdit}
          </Button>
        </>
      }
    />
  );

  /** One plugin: folded to its row, its parts underneath. */
  const groupSection = (group: AgentPluginGroup) => {
    const title = titleOf(group);
    const icon = group.plugin?.icon;
    const { skills, hooks, mcpServers, workbenches } = group.parts;
    const canUpdate = group.status === "update" || group.status === "incomplete";
    return (
      <CollapsibleSection
        key={group.name}
        defaultOpen={false}
        leading={<SkillTile icon={icon} name={group.name} fallback={ICONS.puzzle} />}
        title={
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate" data-tooltip={group.name} data-tooltip-content="code">
                {title}
              </span>
              <Pill
                tone={STATUS_TONE[group.status]}
                tooltip={S.agentPlugins.statusHint[group.status]}
              >
                {S.agentPlugins.status[group.status]}
              </Pill>
            </span>
            <span className="mt-0.5 block truncate text-xs font-normal text-fg-muted">
              {S.agentPlugins.partSummary(
                skills.length,
                hooks.length > 0,
                mcpServers.length,
                workbenches.length,
              )}
            </span>
          </>
        }
        actions={
          <>
            {canUpdate && (
              <Button
                size="sm"
                aria-label={`${S.skills.updateAction} ${title}`}
                disabled={running}
                onClick={() => setPending({ group, verb: "update" })}
              >
                {S.skills.updateAction}
              </Button>
            )}
            {isOwner && (
              <IconButton
                variant="danger"
                label={`${S.skills.uninstall} ${title}`}
                title={S.skills.uninstall}
                disabled={running}
                onClick={() => setPending({ group, verb: "uninstall" })}
              >
                <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
              </IconButton>
            )}
          </>
        }
      >
        <ul aria-label={title}>
          {skills.map(skillRows.row)}
          {hooks.map(hookRows.row)}
          {mcpServers.map((server) => mcpRow(server, icon))}
          {workbenches.map((workbench) => workbenchRows.row(workbench, icon))}
        </ul>
      </CollapsibleSection>
    );
  };

  /** The parts an uninstall removes, as the confirmation lists them. */
  const partLines = (group: AgentPluginGroup) => [
    ...group.parts.skills.map((s) => S.agentPlugins.partSkill(s.name)),
    ...group.parts.hooks.map((h) => S.agentPlugins.partHook(h.name)),
    ...group.parts.mcpServers.map((m) => S.agentPlugins.partMcp(m.name)),
    ...group.parts.workbenches.map((w) => S.agentPlugins.partWorkbench(w.id)),
  ];

  const pendingTitle = pending === null ? "" : titleOf(pending.group);

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabPlugins}>
        {S.agentPlugins.tabDesc}
        {!isOwner && <span className="mt-1.5 block">{S.agentPlugins.readOnlyHint}</span>}
      </HelpFold>

      {error !== null && (
        <NoticeStrip tone="danger">
          {error}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </NoticeStrip>
      )}

      {/* The header: right-aligned, in every list state, so the actions never shift. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Dropdown
          open={importOpen}
          setOpen={setImportOpen}
          className="flex shrink-0"
          menuClass="w-72 max-w-[calc(100vw-2rem)]"
          portal={{ direction: "down", align: "right" }}
          button={
            <Button
              size="sm"
              variant="primary"
              disabled={lists === null}
              aria-haspopup="menu"
              aria-expanded={importOpen}
              onClick={() => setImportOpen(!importOpen)}
            >
              {S.agentPlugins.importAction}
              <ChevronDown size={ICON_SIZE.caret} />
            </Button>
          }
        >
          <Menu label={S.agentPlugins.importMenu}>
            {(
              [
                ["skill", BOOK_ICON, S.agentPlugins.importSkill, S.agentPlugins.importChatOrZip],
                ["hook", ICONS.fishHook, S.agentPlugins.importHook, S.agentPlugins.importChatOrZip],
                [
                  "workbench",
                  ICONS.anvil,
                  S.agentPlugins.importWorkbench,
                  S.agentPlugins.importChatOrZip,
                ],
              ] as const
            ).map(([kind, glyph, label, description]) => (
              <MenuItem
                key={kind}
                glyph={glyph}
                label={label}
                description={description}
                onSelect={() => {
                  setImportOpen(false);
                  setImporting(kind);
                }}
              />
            ))}
          </Menu>
        </Dropdown>
        <Button
          size="sm"
          onClick={() => {
            // The Plugins page's current Agent is one of this server's; a machine's never is.
            if (machineId === null) setCurrentAgentId(agentId);
            void navigate("/plugins");
          }}
        >
          {S.agentPlugins.browseLibrary}
        </Button>
      </div>

      {/* The switches: one ruled list, the owner's to flip, once their state is known. */}
      {lists !== null && (
        <Card padding="md">
          <SettingsGroup>
            {skillsSwitch.toggleCard}
            {hooksSwitch.toggleCard}
            {/* A server older than the switches says nothing about them, and gets none. */}
            {allEnabled !== undefined && (
              <ToggleRow
                label={S.workbenches.enableAll}
                info={S.workbenches.enableAllHint}
                checked={workbenchesSwitch.value}
                disabled={workbenchesSwitch.busy || !isOwner}
                onChange={(next) => void workbenchesSwitch.set(next)}
              />
            )}
          </SettingsGroup>
        </Card>
      )}
      {skillsSwitch.alertStrip}
      {skillsSwitch.promptSection}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{S.agentPlugins.installedTitle}</h3>
        {lists === null ? (
          error === null && <SkeletonList rows={3} />
        ) : groups.length === 0 ? (
          <SettingsEmpty>{S.agentPlugins.empty}</SettingsEmpty>
        ) : (
          <div className="space-y-2">{groups.map(groupSection)}</div>
        )}
      </section>

      {own !== null && hasParts(own) && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{S.agentPlugins.ownTitle}</h3>
          <SettingsList label={S.agentPlugins.ownTitle}>
            {own.skills.map(skillRows.row)}
            {own.hooks.map(hookRows.row)}
            {own.workbenches.map((workbench) => workbenchRows.row(workbench))}
          </SettingsList>
        </section>
      )}

      {skillRows.modals}
      {hookRows.modals}
      {workbenchRows.modals}

      {/* Update: the library's copy over the Agent's, local edits lost — asked first, as on the
          Plugins page, with the commands its stdio servers run where it has any. */}
      {pending?.verb === "update" && pending.group.plugin !== null && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(pendingTitle)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={running}
          onClose={() => {
            if (!running) setPending(null);
          }}
          onConfirm={() => void runUpdate(pending.group, pendingTitle)}
        >
          <p className="text-sm text-fg-muted">{S.plugins.updateConfirmWarning(pendingTitle)}</p>
          <StdioDisclosure plugins={[pending.group.plugin]} className="mt-3" />
        </ConfirmModal>
      )}

      {/* Uninstall: every part named before it goes, and what a workbench takes with it. */}
      {pending?.verb === "uninstall" && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(pendingTitle)}
          confirmLabel={S.skills.uninstall}
          cancelLabel={S.common.cancel}
          busy={running}
          onClose={() => {
            if (!running) setPending(null);
          }}
          onConfirm={() => void uninstallPlugin(pending.group, pendingTitle)}
        >
          <div className="space-y-2 text-sm text-fg-muted">
            <p>{S.agentPlugins.uninstallBody(pendingTitle, agentName)}</p>
            <ul className="space-y-1 text-xs">
              {partLines(pending.group).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {pending.group.parts.workbenches.length > 0 && (
              <p>{S.agentPlugins.uninstallWorkbenchData}</p>
            )}
          </div>
        </ConfirmModal>
      )}

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
