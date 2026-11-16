/**
 * The hook packages of one Agent on its settings page's Plugins tab (plugins-tab.tsx): the row
 * each installed package shows in its plugin's group or among the user's own, with its uninstall,
 * and the "Import hook" dialog. A package is agent_state/hooks/<name>/ — a manifest plus the
 * scripts the harness runs at the loop's hook points, e.g. after every Task — and the files are
 * the single source of truth, so the tab reads its lists again after every change.
 *
 * A row leads with the icon of the plugin the package came from (the hook glyph when it has
 * none), then the package name with the hook points it answers at right beside it (one bare chip
 * each — `stop`, `user_prompt` — wrapping with the name), its localized description below, and
 * the trailing slot: the version, export and uninstall. Export downloads the installed directory
 * as a zip; uninstall confirms first. Both are member-level, matching the hooks routes.
 *
 * The "Import hook" dialog is the Skills import's (chat-or-zip-import-dialog.tsx) with its two
 * paths: the recommended chat import (a source field taking a URL / repo / local path /
 * description / another tool's hooks config, whose generated review-then-install prompt —
 * hook-import.ts — can be copied or prefilled into a new chat with this Agent) and a zip upload
 * that takes such a package back (409 hook_exists asks before overwriting).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { HookItem } from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  ICONS,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { localizedText } from "../../lib/skill-use";
import { SkillTile } from "../skills";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildHookImportPrompt } from "./hook-import";
import { toastApiError } from "../../lib/toast-api-error";

/**
 * The rows of an Agent's hook packages and the one uninstall confirmation they share. `agentName`
 * names the Agent in the confirmation and the toast; `onChanged` reads the tab's lists again
 * after an uninstall.
 */
export function useHookRows({
  agentId,
  agentName,
  onChanged,
}: {
  agentId: string;
  agentName: string;
  onChanged: () => Promise<void>;
}): { row: (hook: HookItem) => ReactNode; modals: ReactNode } {
  const { locale } = useLocale();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on (null: this server). */
  const machineId = useAgentLocation();
  const [busy, setBusy] = useState(false);
  // Package name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);

  /** "Export as zip": the shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportHook = async (name: string) => {
    if (!projectId) return;
    try {
      await downloadArchive(api.agentHookArchiveUrl(projectId, agentId, name, machineId), name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-read the lists from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.uninstallAgentHook(projectId, agentId, removing, machineId);
      toastSuccess(S.hooks.uninstalledToast(removing, agentName));
      await onChanged();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const row = (hook: HookItem) => {
    const description = localizedText(locale, hook.description, hook.descriptionZh);
    return (
      <li
        key={`hook:${hook.name}`}
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
        {/* Icon-only row actions (the Skill rows' pair: neutral bordered icon for export, danger
            variant with red text/hover for delete); the tooltip + aria-label carry the wording. */}
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
      </li>
    );
  };

  // The uninstall confirmation (shared ConfirmModal, the Skill rows' pattern).
  const modals = (
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
  );

  return { row, modals };
}

/**
 * The "Import hook" dialog: the shared chat-or-zip import, with a multi-line source (a whole
 * pasted hooks config block fits), a prompt in which a URL / repo / path source gets an import
 * lead sentence and free text is the lead itself (see hook-import.ts), and the zip going to the
 * hooks archive endpoint of the server the Agent lives on.
 */
export function HookImportDialog({
  projectId,
  agentId,
  onClose,
  onImported,
}: {
  projectId: string;
  agentId: string;
  onClose: () => void;
  /** A zip landed: the tab closes the dialog and reads the lists again. */
  onImported: () => void;
}) {
  const machineId = useAgentLocation();
  return (
    <ChatOrZipImportDialog
      title={S.hooks.importHook}
      strings={S.hooks}
      multilineSource
      buildPrompt={(source) => buildHookImportPrompt(source, projectId, agentId)}
      agentId={agentId}
      accept=".zip"
      upload={(body) => api.installAgentHookArchive(projectId, agentId, body, machineId)}
      conflictCode="hook_exists"
      onClose={onClose}
      onImported={onImported}
    />
  );
}
