/**
 * The hook packages of one Agent on its settings page's Plugins tab, Hooks sub-page
 * (plugins-tab.tsx): the row each installed package shows, with its uninstall, and the "Import
 * hook" dialog. A package is agent_state/hooks/<name>/ — a manifest plus the scripts the harness
 * runs at the loop's hook points, e.g. after every Task — and the files are the single source of
 * truth, so the tab reads its lists again after every change.
 *
 * A row is the shared list row, read like a Skill's: the icon of the plugin the package came
 * from (the hook glyph when it has none), then the package name with — right beside it — the
 * puzzle mark naming the plugin that installed it, when one did, and the hook points it answers
 * at (one bare chip each — `stop`, `user_prompt` — wrapping under the name), its localized
 * description below, then the version, export and uninstall. Export downloads the installed
 * directory as a zip; uninstall confirms first, and says which plugin installed the package when
 * one did. Both are member-level, matching the hooks routes.
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
  ConfirmModal,
  DownloadIcon,
  GlyphAction,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  ListRow,
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
import type { PartSource } from "./plugins-subpages";

/**
 * The rows of an Agent's hook packages and the one uninstall confirmation they share. `agentName`
 * names the Agent in the confirmation and the toast; `onChanged` reads the tab's lists again
 * after an uninstall; `sourceOf` names the plugin a package came from, whose detail
 * `onOpenPlugin` opens.
 */
export function useHookRows({
  agentId,
  agentName,
  onChanged,
  sourceOf,
  onOpenPlugin,
}: {
  agentId: string;
  agentName: string;
  onChanged: () => Promise<void>;
  /** The plugin that installed a hook package, by its name; undefined for the user's own. */
  sourceOf: (name: string) => PartSource | undefined;
  onOpenPlugin: (plugin: string) => void;
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
    const source = sourceOf(hook.name);
    return (
      <ListRow
        key={`hook:${hook.name}`}
        as="li"
        leading={<SkillTile icon={hook.icon} name={hook.name} fallback={ICONS.fishHook} />}
        title={
          <span className="font-mono text-[length:var(--ui-text-code-size)] font-semibold">
            {hook.name}
          </span>
        }
        // The plugin's mark, then the hook points it answers at: bare point names that wrap
        // under the name rather than truncating.
        titleTrail={
          <>
            {source !== undefined && (
              <GlyphAction
                glyph={ICONS.puzzle}
                label={S.agent.mcpInstalledBy(source.title)}
                onClick={() => onOpenPlugin(source.name)}
              />
            )}
            {hook.events.map((event) => (
              <Badge key={event}>{event}</Badge>
            ))}
          </>
        }
        description={description}
        meta={hook.version || undefined}
        trailing={
          <>
            <IconButton
              label={`${S.hooks.exportHook} ${hook.name}`}
              title={S.hooks.exportHook}
              disabled={busy}
              onClick={() => void exportHook(hook.name)}
            >
              <DownloadIcon size={ICON_SIZE.iconButton} />
            </IconButton>
            <IconButton
              variant="danger"
              label={`${S.skills.uninstall} ${hook.name}`}
              title={S.skills.uninstall}
              disabled={busy}
              onClick={() => setRemoving(hook.name)}
            >
              <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
            </IconButton>
          </>
        }
      />
    );
  };

  /** The plugin the package being uninstalled came from: the confirmation says where to get it back. */
  const removingSource = removing !== null ? sourceOf(removing) : undefined;
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
      <div className="space-y-2 text-sm text-fg-muted">
        <p>{removing !== null ? S.hooks.uninstallConfirmBody(removing, agentName) : ""}</p>
        {removingSource !== undefined && (
          <p>{S.agentPlugins.partFromPluginNote(removingSource.title)}</p>
        )}
      </div>
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
  /** A zip landed: the sub-page closes the dialog and reads the lists again. */
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
