/**
 * The writes of the Agent settings Plugins sub-page — installing, updating and (the Project
 * owner's) uninstalling one library plugin on this Agent — as one hook the cards and the detail's
 * footer share, with the confirmations each asks first:
 *
 * - Install, any member's: at once, unless the plugin brings a stdio server the Agent does not
 *   carry yet (`installNeedsConfirm`); then it asks, naming each command and where it runs.
 * - Update, any member's: always asks, since it writes the library's copy over the Agent's, local
 *   edits included. The confirmation lists what it rewrites (`PluginUpdateParts`) and, where the
 *   plugin has stdio servers, the commands they run.
 * - Uninstall, the owner's: always asks — every part by name, and a workbench's data and versions
 *   going with it. One request takes the whole plugin; a part the server could not remove is named
 *   with why, and nothing left to remove counts as done.
 *
 * One write runs at a time: its button shows it running and the others take no press. Nothing
 * moves before the server answers — the card changes section when the lists read again land.
 * A failed write is said in a toast (a machine older than the request needs an update) and its
 * dialog stays open; nothing is read again.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ConfirmModal, ICONS, toastError, toastSuccess } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { localizedText } from "../../lib/skill-use";
import {
  PluginUpdateParts,
  StdioInstallBody,
  installNeedsConfirm,
  installOnAgent,
  stdioServers,
  toastWriteError,
  uninstallFromAgent,
  type AgentInstalls,
  type AgentPluginGroup,
  type AgentTarget,
} from "../plugins";

/** What a plugin is called on this page: the library's display name, else its name. */
export function agentPluginTitle(entry: AgentPluginGroup, locale: "zh" | "en"): string {
  return entry.plugin === null
    ? entry.name
    : localizedText(locale, entry.plugin.title || entry.name, entry.plugin.titleZh);
}

/** The parts an uninstall removes, as its confirmation lists them. */
const partLines = (entry: AgentPluginGroup) => [
  ...entry.parts.skills.map((s) => S.agentPlugins.partSkill(s.name)),
  ...entry.parts.hooks.map((h) => S.agentPlugins.partHook(h.name)),
  ...entry.parts.mcpServers.map((m) => S.agentPlugins.partMcp(m.name)),
  ...entry.parts.workbenches.map((w) => S.agentPlugins.partWorkbench(w.id)),
];

export interface AgentPluginActions {
  /** The plugin a write is running on; null when idle. */
  running: string | null;
  install: (entry: AgentPluginGroup) => void;
  update: (entry: AgentPluginGroup) => void;
  uninstall: (entry: AgentPluginGroup) => void;
  /** The confirmations; render them once, beside the cards. */
  modals: ReactNode;
}

export function useAgentPluginActions({
  target,
  agentName,
  machineLabel,
  installs,
  locale,
  onChanged,
}: {
  target: AgentTarget;
  /** As toasts and confirmations name the Agent. */
  agentName: string;
  /** The ssh alias of the machine the Agent lives on, for the stdio sentence; undefined on this server. */
  machineLabel: string | undefined;
  /** What the Agent carries now. */
  installs: AgentInstalls | undefined;
  locale: "zh" | "en";
  /** Reads the lists again after a write. */
  onChanged: () => Promise<void>;
}): AgentPluginActions {
  const [running, setRunning] = useState<string | null>(null);
  /** The write waiting for its confirmation. */
  const [pending, setPending] = useState<{
    entry: AgentPluginGroup;
    verb: "install" | "update" | "uninstall";
  } | null>(null);

  /** Install or update: the library's copy written onto the Agent, which puts a missing part back too. */
  const runInstall = async (entry: AgentPluginGroup, verb: "install" | "update") => {
    const title = agentPluginTitle(entry, locale);
    setRunning(entry.name);
    try {
      await installOnAgent(target, [entry.name]);
      const said =
        verb === "update"
          ? S.agentPlugins.updatedToast(title, agentName)
          : S.plugins.installedToast(title, agentName);
      toastSuccess(`${said}${S.agent.takesEffectSuffix}`);
      setPending(null);
      await onChanged();
    } catch (e) {
      toastWriteError(e, target.machineId);
    } finally {
      setRunning(null);
    }
  };

  const runUninstall = async (entry: AgentPluginGroup) => {
    const title = agentPluginTitle(entry, locale);
    setRunning(entry.name);
    try {
      const outcome = await uninstallFromAgent(target, entry.name, entry.plugin);
      if (outcome.kind === "removed" && outcome.failed.length > 0) {
        const named = outcome.failed.map((f) => S.agentPlugins.failedPart(f.name, f.error));
        toastError(S.agentPlugins.uninstallPartly(title, named.join(S.todo.listSeparator)));
      } else {
        toastSuccess(`${S.plugins.uninstalledToast(title, agentName)}${S.agent.takesEffectSuffix}`);
      }
      setPending(null);
      await onChanged();
    } catch (e) {
      toastWriteError(e, target.machineId);
    } finally {
      setRunning(null);
    }
  };

  const install = (entry: AgentPluginGroup) => {
    if (running !== null || entry.plugin === null) return;
    if (installNeedsConfirm(entry.plugin, installs)) setPending({ entry, verb: "install" });
    else void runInstall(entry, "install");
  };
  const update = (entry: AgentPluginGroup) => {
    if (running !== null || entry.plugin === null) return;
    setPending({ entry, verb: "update" });
  };
  const uninstall = (entry: AgentPluginGroup) => {
    if (running !== null) return;
    setPending({ entry, verb: "uninstall" });
  };

  const busy = running !== null;
  const close = () => {
    if (!busy) setPending(null);
  };
  const entry = pending?.entry;
  const plugin = entry?.plugin ?? null;
  const title = entry === undefined ? "" : agentPluginTitle(entry, locale);

  const modals = (
    <>
      {pending?.verb === "install" && plugin !== null && (
        <ConfirmModal
          open
          title={S.plugins.installStdioTitle(title, agentName)}
          tone="primary"
          glyph={ICONS.terminalPrompt}
          confirmLabel={S.skills.install}
          cancelLabel={S.common.cancel}
          busy={busy}
          onClose={close}
          onConfirm={() => void runInstall(pending.entry, "install")}
        >
          <StdioInstallBody
            plugin={plugin}
            lead={S.plugins.installStdioTitle(title, agentName)}
            machine={machineLabel}
          />
        </ConfirmModal>
      )}

      {pending?.verb === "update" && plugin !== null && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(title)}
          tone="primary"
          // Wide enough for a Skill's name beside its `old → new` versions, read whole.
          widthClass="sm:max-w-lg"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={busy}
          onClose={close}
          onConfirm={() => void runInstall(pending.entry, "update")}
        >
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">{S.plugins.updateConfirmWarning(title)}</p>
            <PluginUpdateParts
              plugin={plugin}
              agents={[{ key: target.agentId, name: agentName, installs }]}
            />
            {/* The reinstall writes the plugin's stdio servers again: what each runs is said first. */}
            {stdioServers(plugin).length > 0 && (
              <StdioInstallBody plugin={plugin} machine={machineLabel} />
            )}
          </div>
        </ConfirmModal>
      )}

      {pending?.verb === "uninstall" && entry !== undefined && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(title)}
          confirmLabel={S.skills.uninstall}
          cancelLabel={S.common.cancel}
          busy={busy}
          onClose={close}
          onConfirm={() => void runUninstall(pending.entry)}
        >
          <div className="space-y-2 text-sm text-fg-muted">
            <p>{S.agentPlugins.uninstallBody(title, agentName)}</p>
            <ul className="space-y-1 text-xs">
              {partLines(entry).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {entry.parts.workbenches.length > 0 && <p>{S.agentPlugins.uninstallWorkbenchData}</p>}
          </div>
        </ConfirmModal>
      )}
    </>
  );

  return { running, install, update, uninstall, modals };
}
