/**
 * The Skills of one Agent on its settings page's Plugins tab (plugins-tab.tsx): the row each
 * installed Skill shows in its plugin's group or among the user's own, with its uninstall, and
 * the "Import skill" dialog. The files under agent_state/skills/<name>/ are the single source of
 * truth, so the tab reads its lists again after every change rather than trusting what it shows.
 *
 * A row leads with the icon of the plugin the Skill came from (the book glyph when it has none),
 * then the name, the localized short description and the version; its actions export the
 * installed directory as a zip (which round-trips through the import) and uninstall it, which
 * confirms first since it deletes the whole directory, local edits included. Both are
 * member-level, matching the skills routes.
 *
 * The "Import skill" dialog is the shared chat-or-zip import (chat-or-zip-import-dialog.tsx, the
 * hook and workbench imports' too) with two paths: the recommended chat install (a source field
 * accepting a web page / repo URL / local path / foreign install command — see
 * skill-import-source.ts — whose generated review-then-install prompt can be copied or prefilled
 * into a new chat with this Agent) and a zip upload posted base64 to the archive endpoint (409
 * skill_exists asks before overwriting).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  ICONS,
  IconButton,
  ListRow,
  ICON_SIZE,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { SkillTile } from "../skills";
import { localizedShortText } from "../../lib/skill-use";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildImportPrompt } from "./skill-import-source";
import { toastApiError } from "../../lib/toast-api-error";

/**
 * The rows of an Agent's Skills and the one uninstall confirmation they share. `agentName` names
 * the Agent in the confirmation and the toast; `onChanged` reads the tab's lists again after an
 * uninstall.
 */
export function useSkillRows({
  agentId,
  agentName,
  onChanged,
}: {
  agentId: string;
  agentName: string;
  onChanged: () => Promise<void>;
}): { row: (skill: SkillMetadataItem) => ReactNode; modals: ReactNode } {
  const { locale } = useLocale();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on (null: this server). */
  const machineId = useAgentLocation();
  const [busy, setBusy] = useState(false);
  // Skill name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);

  /** "Export as zip": the shared archive download (archive-download.ts); a failure surfaces as a toast. */
  const exportSkill = async (name: string) => {
    if (!projectId) return;
    try {
      await downloadArchive(api.agentSkillArchiveUrl(projectId, agentId, name, machineId), name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-read the lists from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.removeAgentSkill(projectId, agentId, removing, machineId);
      toastSuccess(`${S.skills.uninstalledToast(removing, agentName)}${S.agent.takesEffectSuffix}`);
      await onChanged();
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const row = (skill: SkillMetadataItem) => (
    <ListRow
      key={`skill:${skill.name}`}
      as="li"
      leading={<SkillTile icon={skill.icon} name={skill.name} />}
      title={
        <span className="font-mono text-[length:var(--ui-text-code-size)] font-semibold">
          {skill.name}
        </span>
      }
      description={
        <span
          data-tooltip={skill.description}
          data-tooltip-content="text"
          data-tooltip-extra={skill.description !== localizedShortText(locale, skill)}
        >
          {localizedShortText(locale, skill)}
        </span>
      }
      // The installed copy's version (`YYYY.MM.DD.N`, or the legacy `YYYY-MM-DD.N` on a copy
      // installed before that spelling; empty when the frontmatter carries none), bare like the
      // library card's.
      meta={skill.version || undefined}
      trailing={
        <>
          <IconButton
            label={`${S.skills.exportSkill} ${skill.name}`}
            title={S.skills.exportSkill}
            disabled={busy}
            onClick={() => void exportSkill(skill.name)}
          >
            <DownloadIcon size={ICON_SIZE.iconButton} />
          </IconButton>
          <IconButton
            variant="danger"
            label={`${S.skills.uninstall} ${skill.name}`}
            title={S.skills.uninstall}
            disabled={busy}
            onClick={() => setRemoving(skill.name)}
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          </IconButton>
        </>
      }
    />
  );

  // The uninstall confirmation (shared ConfirmModal, same copy as the skill library page).
  const modals = (
    <ConfirmModal
      open={removing !== null}
      title={removing !== null ? S.skills.uninstallConfirmTitle(removing) : ""}
      busy={busy}
      onClose={() => setRemoving(null)}
      onConfirm={() => void confirmRemove()}
      confirmLabel={S.skills.uninstall}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {removing !== null ? S.skills.uninstallConfirmBody(removing, agentName) : ""}
      </p>
    </ConfirmModal>
  );

  return { row, modals };
}

/**
 * The "Import skill" dialog: the shared chat-or-zip import, whose prompt tailors its lead
 * sentence to the source kind (URL / repo / path / command / reference — see
 * skill-import-source.ts), and whose zip goes to the Skills archive endpoint of the server the
 * Agent lives on.
 */
export function SkillImportDialog({
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
      title={S.skills.importSkill}
      strings={S.skills}
      buildPrompt={buildImportPrompt}
      agentId={agentId}
      accept=".zip"
      upload={(body) => api.installAgentSkillArchive(projectId, agentId, body, machineId)}
      conflictCode="skill_exists"
      onClose={onClose}
      onImported={onImported}
    />
  );
}
