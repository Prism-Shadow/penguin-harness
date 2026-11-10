/**
 * Agent settings page "Skills" tab: the skills installed on this Agent
 * (agent_state/skills/<name>/ — the files are the single source of truth, so the list is
 * re-fetched from the API after every mutation instead of trusting client state). Rows lead
 * with the icon of the plugin the skill came from (the book glyph when it has none), then
 * the name, localized short description and version; uninstall
 * confirms first (deletes the whole directory, local edits included). The "Import skill"
 * modal (chat-or-zip-import-dialog.tsx, shared with the Hooks and Workbenches tabs) offers two
 * paths: the recommended chat install (a source field accepting a web page / repo URL / local
 * path / foreign install command — see skill-import-source.ts — whose generated
 * review-then-install prompt can be copied or prefilled into a new chat with this Agent) and a
 * zip upload posted base64 to the archive endpoint (409 skill_exists asks before overwriting).
 * Each row can also export the installed directory as a zip that round-trips through that same
 * endpoint. Read and mutate are both member-level, matching the skills routes — no owner gating
 * here.
 *
 * Prompt-injection controls (usePromptInjection): the skills.enabled switch, the
 * {{SKILLS}}-placeholder alert (with legacy-template migration) and the editable
 * skills.prompt section, mirroring the Memory tab.
 */
import { useCallback, useEffect, useState } from "react";

import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  DownloadIcon,
  GlyphIcon,
  HelpFold,
  ICONS,
  IconButton,
  SettingsEmpty,
  SettingsList,
  ListRow,
  ICON_SIZE,
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
import { SkillTile } from "../skills";
import { localizedShortText } from "../../lib/skill-use";
import { downloadArchive } from "./archive-download";
import { ChatOrZipImportDialog } from "./chat-or-zip-import-dialog";
import { buildImportPrompt } from "./skill-import-source";
import { usePromptInjection } from "./prompt-injection-controls";
import { toastApiError } from "../../lib/toast-api-error";

export function SkillsTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes (toggle / prompt / placeholder insert) happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { locale } = useLocale();
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on (null: this server), and the Agents that server runs. */
  const machineId = useAgentLocation();
  const agents = useAgentsOn(machineId);
  // Prompt-injection controls (toggle / template alert / prompt editor): member-level like
  // every other mutation on this tab.
  const { applyConfig, toggleCard, alertStrip, promptSection } = usePromptInjection({
    agentId,
    feature: "skills",
    strings: S.skills.injection,
    canEdit: true,
    onConfigChanged,
  });

  const [skills, setSkills] = useState<SkillMetadataItem[] | null>(null);
  // Tab-level error is only the initial list load failure; row/import actions report via toast or inside the modal.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Skill name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);
  // The import dialog; what it holds (the source, the upload) lives in it, while it is open.
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setSkills(null);
    setError(null);
    try {
      // The injection controls' state loads in parallel with the tab's own list.
      const [res, configView] = await Promise.all([
        api.getAgentSkills(projectId, agentId, machineId),
        api.getAgentConfig(projectId, agentId, machineId),
      ]);
      setSkills(res.skills);
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
  const exportSkill = async (name: string) => {
    if (!projectId) return;
    try {
      await downloadArchive(api.agentSkillArchiveUrl(projectId, agentId, name, machineId), name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-fetch the list from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.removeAgentSkill(projectId, agentId, removing, machineId);
      toastSuccess(`${S.skills.uninstalledToast(removing, agentName)}${S.agent.takesEffectSuffix}`);
      await load();
      // The agent card's skill count changed; refresh the list provider too.
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
    toastSuccess(`${S.skills.importDoneToast}${S.agent.takesEffectSuffix}`);
    await load();
    // The agent card's skill count changed; refresh the list provider too.
    if (machineId === null) void reloadAgents();
  };

  /** Metadata: the installed copy's version (`YYYY.MM.DD.N`, or the legacy `YYYY-MM-DD.N` on a copy installed before that spelling; empty when the frontmatter carries none), shown bare like the library card. */
  const metaLine = (skill: SkillMetadataItem): string => skill.version;

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabSkills}>{S.skills.agentTabDesc}</HelpFold>

      {toggleCard}
      {alertStrip}

      {/* Import entry point at the head of the installed list, right-aligned — the admin users
          page puts its create action in the same slot above its table. It renders in every list
          state (loading, empty, populated) so the action never shifts and the dashed empty block
          keeps a header instead of standing alone; the modal carries both install paths. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={skills === null}
          onClick={() => setImportOpen(true)}
        >
          {S.skills.importSkill}
        </Button>
      </div>

      {skills === null ? (
        <SkeletonList rows={4} />
      ) : skills.length === 0 ? (
        <SettingsEmpty>{S.skills.agentTabEmpty}</SettingsEmpty>
      ) : (
        <SettingsList label={S.agent.tabSkills}>
          {skills.map((skill) => (
            <ListRow
              key={skill.name}
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
              meta={metaLine(skill) || undefined}
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
          ))}
        </SettingsList>
      )}

      {promptSection}

      {importOpen && (
        <ChatOrZipImportDialog
          title={S.skills.importSkill}
          strings={S.skills}
          // The prompt tailors its lead sentence to the source kind (URL / repo / path / command /
          // reference — see skill-import-source.ts).
          buildPrompt={buildImportPrompt}
          agentId={agentId}
          accept=".zip"
          upload={(body) => api.installAgentSkillArchive(projectId, agentId, body, machineId)}
          conflictCode="skill_exists"
          onClose={() => setImportOpen(false)}
          onImported={() => void imported()}
        />
      )}

      {/* Uninstall confirmation (shared ConfirmModal, same copy as the skill library page). */}
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

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
