/**
 * Agent settings page "Skills" tab: the skills installed on this Agent
 * (agent_state/skills/<name>/ — the files are the single source of truth, so the list is
 * re-fetched from the API after every mutation instead of trusting client state). Rows show
 * the skill icon, name, localized short description and version; uninstall
 * confirms first (deletes the whole directory, local edits included). The "Import skill"
 * modal offers two paths: the recommended chat install (a source field accepting a web
 * page / repo URL / local path / foreign install command — see skill-import-source.ts —
 * whose generated review-then-install prompt can be copied or prefilled into a new chat
 * with this Agent) and a zip upload posted base64 to the archive endpoint (409
 * skill_exists asks before overwriting). Each row can also export the installed directory
 * as a zip that round-trips through that same endpoint. Read and mutate are both
 * member-level, matching the skills routes — no owner gating here.
 *
 * Prompt-injection controls (usePromptInjection): the skills.enabled switch, the
 * {{SKILLS}}-placeholder alert (with legacy-template migration) and the editable
 * skills.prompt section, mirroring the Memory tab.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { CopiedStatus, CopyCheckGlyph, useCopied } from "../../components/ui/copy-button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { DownloadIcon } from "../../components/ui/icons";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { SkillIcon, skillTileColor } from "../skills/skill-icon-view";
import { localizedShortText } from "../chat/skill-use";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { parkActiveDraft } from "../chat/draft-sessions";
import { buildImportPrompt } from "./skill-import-source";
import { usePromptInjection } from "./prompt-injection-controls";
import { HelpFold } from "../../components/ui/help-fold";

/** <label> version of the button look (matches Button secondary sm; the Button component only renders <button>) — same as the Overview tab's snapshot-import label. */
const UPLOAD_LABEL_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-gray-300 " +
  "bg-white px-2.5 py-1 text-xs font-medium text-gray-800 transition-colors duration-150 " +
  "hover:bg-gray-50 focus-within:ring-2 focus-within:ring-gray-400/30 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800";

/** Delete (trash can) icon path — the same glyph as the agents page card delete; the Hooks tab's row delete borrows it. */
export const TRASH_ICON =
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6";

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
  const navigate = useNavigate();
  const { locale } = useLocale();
  const userId = useAuth().user?.userId ?? null;
  const { currentProject, agents, setCurrentAgentId, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
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
  // Import modal: the source for the chat-install prompt + upload state travel with the modal.
  const [importOpen, setImportOpen] = useState(false);
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Non-null shows the overwrite confirm (the archive POST answered 409 skill_exists).
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setSkills(null);
    setError(null);
    try {
      // The injection controls' state loads in parallel with the tab's own list.
      const [res, configView] = await Promise.all([
        api.getAgentSkills(projectId, agentId),
        api.getAgentConfig(projectId, agentId),
      ]);
      setSkills(res.skills);
      applyConfig(configView.config);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Display name of this Agent for toasts / confirm copy (falls back to the raw id). */
  const agent = agents.find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;

  /**
   * "Export as zip": fetch the archive and save it via a temporary object-URL anchor.
   * The codebase's other downloads are bare `<a href download>` anchors (snapshot export,
   * trace download), but a bare anchor would save the error JSON as a file when the
   * request fails — fetching first lets failures surface as a toast instead. The JSON-only
   * api client can't carry binary, hence the raw fetch (errors re-wrapped as ApiError so
   * apiErrorText localizes by code as usual).
   */
  const exportSkill = async (name: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(api.agentSkillArchiveUrl(projectId, agentId, name));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        throw new ApiError(
          res.status,
          body?.error?.code ?? "unknown",
          body?.error?.message ?? S.common.unknownError,
        );
      }
      // The server's Content-Disposition is the authority on the filename (it appends
      // -v<version> when the frontmatter declares one explicitly); <name>.zip is only
      // the fallback for a missing/unparseable header.
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(
        res.headers.get("content-disposition") ?? "",
      )?.[1];
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = encoded ? decodeURIComponent(encoded) : `${name}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Confirm modal's "Confirm": uninstall, then always re-fetch the list from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.removeAgentSkill(projectId, agentId, removing);
      toastSuccess(S.skills.uninstalledToast(removing, agentName));
      await load();
      // The agent card's skill count changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  /** Open the import modal (reset the form and upload state). */
  const openImport = () => {
    setSource("");
    setUploadError(null);
    setOverwriting(null);
    setImportOpen(true);
  };

  // The prompt tailors its lead sentence to the source kind (URL / repo / path / command /
  // reference — see skill-import-source.ts); the preview substitutes a placeholder token
  // until something is entered.
  const trimmedSource = source.trim();
  const chatPrompt = buildImportPrompt(trimmedSource || S.skills.importSourceToken);

  // Copy feedback lives at the button (the shared copy convention): its glyph flips to
  // the check while copied — no toast, and the button label never changes.
  const promptCopy = useCopied();

  /**
   * "Open a new chat" with this Agent: the same draft-state entry as the agents page
   * "New Chat" button. A non-empty source also prefills the composer with the generated
   * install prompt through the draft cache — the mechanism the skill library's quick
   * invoke already uses, so draft-view itself needs no changes. handoffAgentId is
   * cleared (a leftover handoff target would forward the install prompt to a different
   * Agent) and the skill pre-selection reset alongside the overwritten text.
   */
  const openChat = () => {
    if (userId && projectId && trimmedSource) {
      // Typed-but-unsent draft text becomes a parked draft conversation instead of being
      // clobbered by the canned import prompt (draft-sessions.ts).
      parkActiveDraft(userId, projectId);
      const key = draftKey(userId, projectId);
      saveDraft(key, {
        ...loadDraft(key),
        agentId,
        text: buildImportPrompt(trimmedSource),
        skills: [],
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /**
   * POST the zip to the archive endpoint. A 409 skill_exists pops the overwrite confirm
   * (the skill name is read from the server's fixed message tail, pinned by the route
   * tests; `fallbackName` — the picked file's stem — covers a parse miss). Success closes
   * the modal and re-fetches the list.
   */
  const upload = async (dataBase64: string, fallbackName: string, overwrite: boolean) => {
    if (!projectId) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.installAgentSkillArchive(projectId, agentId, {
        dataBase64,
        ...(overwrite ? { overwrite: true } : {}),
      });
      setOverwriting(null);
      setImportOpen(false);
      toastSuccess(S.skills.importDoneToast);
      await load();
      // The agent card's skill count changed; refresh the list provider too.
      void reloadAgents();
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

  /** Metadata: the installed copy's version (`YYYY-MM-DD.N`; empty when the frontmatter carries none), shown bare like the library card. */
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
        <Button size="sm" variant="primary" disabled={skills === null} onClick={openImport}>
          {S.skills.importSkill}
        </Button>
      </div>

      {skills === null ? (
        <SkeletonList rows={4} />
      ) : skills.length === 0 ? (
        <SettingsEmpty>{S.skills.agentTabEmpty}</SettingsEmpty>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${skillTileColor(skill.name)}`}
              >
                <SkillIcon icon={skill.icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className="block truncate font-mono text-[13px] font-semibold"
                  title={skill.name}
                >
                  {skill.name}
                </span>
                {/* Short description truncates to one line (full description goes into title for hover reading). */}
                <p
                  className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                  title={skill.description}
                >
                  {localizedShortText(locale, skill)}
                </p>
              </div>
              {metaLine(skill) !== "" && (
                <span
                  className="hidden shrink-0 text-[11px] text-gray-400 sm:block dark:text-gray-500"
                  title={metaLine(skill)}
                >
                  {metaLine(skill)}
                </span>
              )}
              {/* Icon-only row actions (same affordance as the agents page cards: neutral
                  bordered icon for export, danger variant with red text/hover for delete);
                  the tooltip + aria-label carry the wording. */}
              <Button
                size="icon"
                title={S.skills.exportSkill}
                aria-label={`${S.skills.exportSkill} ${skill.name}`}
                disabled={busy}
                onClick={() => void exportSkill(skill.name)}
              >
                <DownloadIcon size={14} className="text-gray-600 dark:text-gray-300" />
              </Button>
              <Button
                size="icon"
                variant="danger"
                title={S.skills.uninstall}
                aria-label={`${S.skills.uninstall} ${skill.name}`}
                disabled={busy}
                onClick={() => setRemoving(skill.name)}
              >
                <GlyphIcon d={TRASH_ICON} size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {promptSection}

      {/* Import modal: recommended chat install on top, zip upload below. */}
      <Modal
        open={importOpen}
        title={S.skills.importSkill}
        onClose={() => setImportOpen(false)}
        widthClass="sm:max-w-lg"
      >
        <div className="space-y-4">
          <section>
            <p className="text-sm font-medium">{S.skills.importChatTitle}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {S.skills.importChatWhy}
            </p>
            <div className="mt-2.5 space-y-2.5">
              <Input
                size="sm"
                label={S.skills.importSourceLabel}
                hint={S.skills.importSourceHint}
                value={source}
                onChange={(e) => setSource(e.target.value)}
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
                <Button size="sm" variant="primary" onClick={openChat}>
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
        confirmLabel={S.skills.importOverwriteAction}
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

      {/* Uninstall confirmation (shared ConfirmModal, same copy as the skill library page). */}
      <ConfirmModal
        open={removing !== null}
        title={removing !== null ? S.skills.uninstallConfirmTitle(removing) : ""}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.skills.uninstallConfirmBody(removing, agentName) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
