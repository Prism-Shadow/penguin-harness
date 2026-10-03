/**
 * Agent settings page "Skills" tab: the skills installed on this Agent
 * (agent_state/skills/<name>/ — the files are the single source of truth, so the list is
 * re-fetched from the API after every mutation instead of trusting client state). Rows lead
 * with the icon of the plugin the skill came from (the book glyph when it has none), then
 * the name, localized short description and version; uninstall
 * confirms first (deletes the whole directory, local edits included). The "Import skill"
 * modal offers two paths: the recommended chat install (a source field accepting a web
 * page / repo URL / local path / foreign install command — see skill-import-source.ts —
 * whose generated review-then-install prompt can be copied or prefilled into a new chat
 * with this Agent) and a zip upload posted base64 to the archive endpoint (409
 * skill_exists asks before overwriting). Each row can also export the installed directory
 * as a zip that round-trips through that same endpoint. Read and mutate are both
 * member-level, matching the skills routes — no owner gating here.
 *
 * The import dialog is mounted only while it is open, so every opening starts with nothing
 * typed. The source is its draft under the settings commit model: closing the dialog with one
 * typed (Esc, the ×, a press outside) asks first, and nothing closes it while an upload is in
 * flight. Opening the chat hands the source over, so the draft is forgotten before the page
 * moves to the conversation.
 *
 * Prompt-injection controls (usePromptInjection): the skills.enabled switch, the
 * {{SKILLS}}-placeholder alert (with legacy-template migration) and the editable
 * skills.prompt section, mirroring the Memory tab.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  DownloadIcon,
  GlyphIcon,
  HelpFold,
  HiddenFileInput,
  ICONS,
  IconButton,
  Input,
  Modal,
  SettingsEmpty,
  SettingsList,
  ListRow,
  ICON_SIZE,
  SkeletonList,
  Textarea,
  buttonClass,
  discardUnsaved,
  toastError,
  toastSuccess,
  useCopied,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { useAgentLocation } from "../../lib/agent-location";
import { useAgentsOn } from "../../lib/machine-agent-lists";
import { SkillTile } from "../skills";
import { localizedShortText } from "../../lib/skill-use";
import { useAiBridge } from "../ai-create";
import { downloadArchive } from "./archive-download";
import { buildImportPrompt } from "./skill-import-source";
import { usePromptInjection } from "./prompt-injection-controls";

/** The Button look on the upload `<label>`; the Hooks tab's upload label borrows it. */
export const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

/** Zip pending an overwrite confirmation: the payload to resend with overwrite: true plus the skill name for the confirm copy. */
interface PendingOverwrite {
  dataBase64: string;
  name: string;
}

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
      toastError(apiErrorText(e));
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
      toastError(apiErrorText(e));
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
        <SkillImportDialog
          projectId={projectId}
          agentId={agentId}
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

/**
 * The "Import skill" dialog: the recommended chat install on top, the zip upload below. The
 * source is the dialog's draft (compared without the spaces around it): closing with one typed
 * asks first, and an upload in flight holds every way of closing until it answers.
 */
function SkillImportDialog({
  projectId,
  agentId,
  onClose,
  onImported,
}: {
  projectId: string;
  agentId: string;
  onClose: () => void;
  /** A zip landed: the tab closes the dialog and reads the list again. */
  onImported: () => void;
}) {
  const { openAiChat } = useAiBridge();
  const machineId = useAgentLocation();
  const form = useFormDraft<string>("", { normalize: (text) => text.trim() });
  const source = form.draft;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Non-null shows the overwrite confirm (the archive POST answered 409 skill_exists).
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: uploading });

  // The prompt tailors its lead sentence to the source kind (URL / repo / path / command /
  // reference — see skill-import-source.ts); the preview substitutes a placeholder token
  // until something is entered.
  const trimmedSource = source.trim();
  const chatPrompt = buildImportPrompt(trimmedSource || S.skills.importSourceToken);

  // Copy feedback lives at the button (the shared copy convention): its glyph flips to
  // the check while copied — no toast, and the button label never changes.
  const promptCopy = useCopied();

  /**
   * "Open a new chat" with this Agent: the AI bridge prefills the composer with the generated
   * install prompt (parking typed-but-unsent draft text first) and clears a stale handoff
   * target and skill pre-selection along with it. Disabled without a source, like the copy
   * button — a blank chat would drop the prompt the dialog just built. The source goes with
   * the chat, so nothing typed is left to lose: it is forgotten first, or the leave guard
   * would hold the move to the conversation.
   */
  const openChat = () => {
    if (trimmedSource === "") return;
    discardUnsaved(form.scope);
    openAiChat({ agentId, text: buildImportPrompt(trimmedSource), machineId });
    onClose();
  };

  /**
   * POST the zip to the archive endpoint. A 409 skill_exists pops the overwrite confirm
   * (the skill name is read from the server's fixed message tail, pinned by the route
   * tests; `fallbackName` — the picked file's stem — covers a parse miss). Success hands
   * over to the tab, which closes the dialog and re-fetches the list.
   */
  const upload = async (dataBase64: string, fallbackName: string, overwrite: boolean) => {
    setUploading(true);
    setUploadError(null);
    try {
      await api.installAgentSkillArchive(
        projectId,
        agentId,
        { dataBase64, ...(overwrite ? { overwrite: true } : {}) },
        machineId,
      );
      setOverwriting(null);
      onImported();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "skill_exists") {
        const name = /:\s*([A-Za-z0-9_-]+)$/.exec(e.message)?.[1] ?? fallbackName;
        setOverwriting({ dataBase64, name });
      } else {
        setOverwriting(null);
        setUploadError(apiErrorText(e));
      }
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackName = file.name.replace(/\.zip$/i, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackName, false); // strip the data:...;base64, prefix
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Modal open title={S.skills.importSkill} onClose={requestClose} widthClass="sm:max-w-lg">
        <div className="space-y-4">
          <section>
            <p className="text-sm font-medium">{S.skills.importChatTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.skills.importChatWhy}
            </p>
            <div className="mt-2.5 space-y-3">
              <Input
                size="sm"
                label={S.skills.importSourceLabel}
                hint={S.skills.importSourceHint}
                value={source}
                onChange={(e) => form.setDraft(e.target.value)}
                placeholder={S.skills.importSourcePlaceholder}
                autoComplete="off"
              />
              <Textarea
                label={S.skills.importPromptLabel}
                size="sm"
                rows={5}
                readOnly
                value={chatPrompt}
                className="text-gray-600 dark:text-gray-300"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={trimmedSource === ""}
                  onClick={() => promptCopy.flash(buildImportPrompt(trimmedSource))}
                >
                  <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                  {S.skills.importCopyPrompt}
                </Button>
                <CopiedStatus copied={promptCopy.copied} />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={trimmedSource === ""}
                  onClick={openChat}
                >
                  {S.skills.importOpenChat}
                </Button>
              </div>
            </div>
          </section>

          <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="text-sm font-medium">{S.skills.importUploadTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.skills.importUploadDesc}
            </p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
              {uploading ? S.skills.importUploading : S.skills.importUploadAction}
            </label>
            {uploadError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
            )}
          </section>
        </div>
      </Modal>

      {/* Overwrite confirmation: the import modal stays underneath, so cancel returns to it; confirm resends the same zip with overwrite: true. */}
      <ConfirmModal
        open={overwriting !== null}
        title={S.skills.importOverwriteTitle}
        tone="primary"
        confirmLabel={S.skills.importOverwriteAction}
        cancelLabel={S.common.cancel}
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null) void upload(overwriting.dataBase64, overwriting.name, true);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.skills.importOverwriteBody(overwriting.name) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
