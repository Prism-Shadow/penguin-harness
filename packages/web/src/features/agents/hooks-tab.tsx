/**
 * Agent settings page "Hooks" tab: the hook packages installed on this Agent
 * (agent_state/hooks/<name>/ — a manifest plus the scripts the harness runs at the loop's
 * hook points, e.g. after every Task). The files are the single source of truth, so the list
 * is re-fetched from the API after every mutation instead of trusting client state, the way
 * the Skills tab does. Rows lead with the icon of the plugin the package came from (the hook
 * glyph when it has none), then the package name with the hook points it answers at right
 * beside it (one bare chip each — `stop`, `user_prompt` — wrapping with the name), its
 * localized description below, and the trailing slot: the version, export and uninstall.
 * Export downloads the installed directory as a zip; the "Import hook" modal is the Skills
 * tab's (chat-or-zip-import-dialog.tsx) with its two paths: the recommended chat import (a source
 * field taking a URL / repo / local path / description / another tool's hooks config, whose
 * generated review-then-install prompt — hook-import.ts — can be copied or prefilled into a new
 * chat with this Agent) and a zip upload that takes such a package back (409 hook_exists asks
 * before overwriting). Read, import/export and uninstall are member-level, matching the hooks
 * routes.
 *
 * The Agent-level switch card sits at the top (usePromptInjection, the Skills tab's slot):
 * `hooks.enabled` in system_config.yaml decides whether a new Session assembles any hooks at
 * all — the packages are never touched by it. It is the owner's, like the Vault and Schedules
 * switches; members see the state. Hooks have no prompt half, so the card comes alone.
 */
import { useCallback, useEffect, useState } from "react";

import type { HookItem } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  HelpFold,
  ICONS,
  SettingsEmpty,
  SkeletonList,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { useAgentsOn } from "../../lib/machine-agent-lists";
import { localizedText } from "../../lib/skill-use";
import { SkillTile } from "../skills";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildHookImportPrompt } from "./hook-import";
import { usePromptInjection } from "./prompt-injection-controls";
import { toastApiError } from "../../lib/toast-api-error";

export function HooksTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** The switch writes the Agent config directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert it. */
  onConfigChanged?: () => void;
}) {
  const { locale } = useLocale();
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  /** The machine the Agent lives on (null: this server), and the Agents that server runs. */
  const machineId = useAgentLocation();
  const agents = useAgentsOn(machineId);
  // The Agent-level hook switch: owner-only, like the Vault and Schedules switches.
  const { applyConfig, toggleCard } = usePromptInjection({
    agentId,
    feature: "hooks",
    strings: S.hooks.injection,
    canEdit: isOwner,
    onConfigChanged,
  });

  const [hooks, setHooks] = useState<HookItem[] | null>(null);
  // Tab-level error is only the initial list load failure; row actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Package name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);
  // The import dialog; what it holds (the source, the upload) lives in it, while it is open.
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setHooks(null);
    setError(null);
    try {
      // The switch card's state loads in parallel with the tab's own list.
      const [res, configView] = await Promise.all([
        api.getAgentHooks(projectId, agentId, machineId),
        api.getAgentConfig(projectId, agentId, machineId),
      ]);
      setHooks(res.hooks);
      applyConfig(configView.config);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, machineId, applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Display name of this Agent for toasts / confirm copy (falls back to the raw id). */
  const agent = agents.find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;

  /** "Export as zip": the shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportHook = async (name: string) => {
    if (!projectId) return;
    try {
      await downloadArchive(api.agentHookArchiveUrl(projectId, agentId, name, machineId), name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-fetch the list from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.uninstallAgentHook(projectId, agentId, removing, machineId);
      toastSuccess(S.hooks.uninstalledToast(removing, agentName));
      await load();
      // The agent card's hook count (and its plugin-update marks) changed; refresh the list provider too.
      if (machineId === null) void reloadAgents();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  /** An upload landed: the dialog closes and the list is read again from disk. */
  const imported = async () => {
    setImportOpen(false);
    toastSuccess(S.hooks.importDoneToast);
    await load();
    // The agent card's hook count changed; refresh the list provider too.
    if (machineId === null) void reloadAgents();
  };

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabHooks}>
        {S.hooks.agentTabDesc}
        {!isOwner && <span className="mt-1.5 block">{S.hooks.readOnlyHint}</span>}
      </HelpFold>

      {toggleCard}

      {/* Import entry point at the head of the installed list, right-aligned — the Skills tab's
          slot. It renders in every list state so the action never shifts. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={hooks === null}
          onClick={() => setImportOpen(true)}
        >
          {S.hooks.importHook}
        </Button>
      </div>

      {hooks === null ? (
        <SkeletonList rows={3} />
      ) : hooks.length === 0 ? (
        <SettingsEmpty>{S.hooks.agentTabEmpty}</SettingsEmpty>
      ) : (
        <Card padding="none">
          {hooks.map((hook) => {
            const description = localizedText(locale, hook.description, hook.descriptionZh);
            return (
              <div
                key={hook.name}
                className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
              >
                <SkillTile
                  icon={hook.icon}
                  name={hook.name}
                  fallback={ICONS.fishHook}
                  size={36}
                  glyph={20}
                />
                <div className="min-w-0 flex-1">
                  {/* Title row: the name with the hook points it answers at right beside it — bare
                      point names, wrapping onto a second line rather than truncating. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span
                      className="max-w-full truncate font-mono text-[length:var(--ui-text-code-size)] font-semibold"
                      data-tooltip={hook.name}
                      data-tooltip-content="code"
                    >
                      {hook.name}
                    </span>
                    {hook.events.map((event) => (
                      <Badge key={event}>{event}</Badge>
                    ))}
                  </div>
                  {/* Description truncates to one line (the full text goes into title for hover reading). */}
                  <p
                    className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                    data-tooltip={description}
                    data-tooltip-content="text"
                  >
                    {description}
                  </p>
                </div>
                {hook.version !== "" && (
                  <span className="hidden shrink-0 text-xs text-gray-400 sm:block dark:text-gray-500">
                    {hook.version}
                  </span>
                )}
                {/* Icon-only row actions (the Skills tab's pair: neutral bordered icon for export,
                    danger variant with red text/hover for delete); the tooltip + aria-label carry the wording. */}
                <Button
                  size="icon"
                  title={S.hooks.exportHook}
                  aria-label={`${S.hooks.exportHook} ${hook.name}`}
                  disabled={busy}
                  onClick={() => void exportHook(hook.name)}
                >
                  <DownloadIcon size={14} className="text-gray-600 dark:text-gray-300" />
                </Button>
                <Button
                  size="icon"
                  variant="danger"
                  title={S.skills.uninstall}
                  aria-label={`${S.skills.uninstall} ${hook.name}`}
                  disabled={busy}
                  onClick={() => setRemoving(hook.name)}
                >
                  <GlyphIcon d={ICONS.trash} size={14} />
                </Button>
              </div>
            );
          })}
        </Card>
      )}

      {importOpen && (
        <ChatOrZipImportDialog
          title={S.hooks.importHook}
          strings={S.hooks}
          // A source may be a whole pasted hooks config block, so the field is multi-line.
          multilineSource
          // A URL / repo / path source gets an import lead sentence, free text is the lead itself
          // (see hook-import.ts).
          buildPrompt={(source) => buildHookImportPrompt(source, projectId, agentId)}
          agentId={agentId}
          accept=".zip"
          upload={(body) => api.installAgentHookArchive(projectId, agentId, body, machineId)}
          conflictCode="hook_exists"
          onClose={() => setImportOpen(false)}
          onImported={() => void imported()}
        />
      )}

      {/* Uninstall confirmation (shared ConfirmModal, the Skills tab's pattern). */}
      <ConfirmModal
        open={removing !== null}
        title={removing !== null ? S.hooks.uninstallConfirmTitle(removing) : ""}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        confirmLabel={S.skills.uninstall}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.hooks.uninstallConfirmBody(removing, agentName) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
