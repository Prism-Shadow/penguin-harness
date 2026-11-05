/**
 * The Agent import dialog, shared by the Agents page (the header's "Import agent") and the
 * settings page ("Replace from file…", which opens it in replace mode). Two ruled sections, the
 * Skills and Hooks import dialogs' family:
 *
 * 1. **Migrate from another framework.** The framework, a path — its user directory while nothing
 *    is typed, required for "Other" — the full prompt in the fold, and "Open a new chat": the
 *    prompt lands in a new conversation with the Project's default agent (the AI bridge), where
 *    the `agent-porting` Skill does the mapping. Nothing is sent; sending stays the user's. While
 *    that agent lacks the Skill, the section says so and offers to install the plugin that ships
 *    it, and the chat waits (porting-skill-gate.ts).
 * 2. **Import a file.** A zip export (or, until 1.0, an older `.tar.gz` package) no larger than an
 *    import takes — a larger one is refused before anything is sent — the Agent id its file name
 *    suggests (editable; empty takes the id a zip records, while a `.tar.gz`, which records none,
 *    needs one), and Import, which uploads the file as it is (archive-upload.ts). A taken id —
 *    409 `agent_exists` — shows in place, with "Use another id", which focuses the id, and for the
 *    Project owner "Overwrite the existing agent", which asks once (danger) and sends the file
 *    again with `overwrite`.
 *
 * Replace mode drops the first section and the id: the file replaces this Agent's State, and
 * the primary is "Replace", behind the same one confirmation. A landed import says what came in,
 * what was skipped and what is left to fill in, as a toast, and this server's Agent list is read
 * again.
 *
 * A record dialog under the settings commit model: what was typed or picked is its draft, so
 * closing with any of it asks first, and nothing closes it while an upload is in flight. Opening
 * the chat hands the migration's source over, so that part is forgotten before the page moves on;
 * a picked file goes nowhere with it, so the chat asks first while one is picked.
 */
import { useId, useState } from "react";
import type { ChangeEvent } from "react";
import { AGENT_ARCHIVE_MAX_UPLOAD_BYTES } from "@prismshadow/penguin-server/api";
import type { AgentArchiveImportResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  CloseIcon,
  ConfirmModal,
  FieldError,
  FieldHint,
  HiddenFileInput,
  InfoPopover,
  Input,
  Modal,
  Select,
  discardUnsaved,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { toneInk } from "../../lib/tone";
import { agentDisplayName, useProject } from "../../state/project";
import { PromptFold, pickDefaultAgent, useAiBridge } from "../ai-create";
import {
  ARCHIVE_ACCEPT,
  ARCHIVE_BUTTON_CLASS,
  agentIdFromArchiveName,
  isTarPackage,
} from "./archive-file";
import { uploadArchive } from "./archive-upload";
import { MIGRATION_SOURCES, SOURCE_HOME, migrationPrompt } from "./agent-migration";
import type { MigrationSource } from "./agent-migration";
import { importReportText } from "./import-report";
import { PORTING_PLUGIN, usePortingSkill } from "./porting-skill-gate";

export interface AgentImportDialogProps {
  projectId: string;
  /** Replace mode: the Agent whose State a file replaces. Absent, the dialog creates an Agent. */
  replace?: { agentId: string; name: string };
  /** The server the file goes to; null for this one. */
  machineId: string | null;
  onClose: () => void;
  /** An import landed: the dialog has toasted what it did and read this server's Agent list again. */
  onImported: (res: AgentArchiveImportResponse) => void;
}

/** What the dialog holds: the migration's framework and path, and the picked file with its id. */
interface ImportDraft {
  framework: MigrationSource;
  path: string;
  file: File | null;
  agentId: string;
}

const EMPTY: ImportDraft = { framework: "claude-code", path: "", file: null, agentId: "" };

/** What the draft is compared by: the text trimmed, the file by what identifies it. */
const normalizeImport = (draft: ImportDraft) => ({
  ...draft,
  path: draft.path.trim(),
  agentId: draft.agentId.trim(),
  file:
    draft.file === null
      ? null
      : { name: draft.file.name, size: draft.file.size, lastModified: draft.file.lastModified },
});

export function AgentImportDialog({
  projectId,
  replace,
  machineId,
  onClose,
  onImported,
}: AgentImportDialogProps) {
  const { currentProject, agents, reloadAgents } = useProject();
  const isOwner = currentProject?.role === "owner";
  const { openAiChat } = useAiBridge();
  const form = useFormDraft<ImportDraft>(EMPTY, { normalize: normalizeImport });
  const { framework, path, file, agentId } = form.draft;
  const [uploading, setUploading] = useState(false);
  /** Why the server refused the last upload, under the Import button. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The id a 409 `agent_exists` named; cleared by the next edit of the id or the file. */
  const [taken, setTaken] = useState<string | null>(null);
  /** The one confirmation before a State is replaced is open. */
  const [confirming, setConfirming] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: uploading });
  const idFieldId = useId();

  const id = agentId.trim();
  /** A `.tar.gz` records no id: the import needs one named for it. */
  const idRequired = file !== null && isTarPackage(file.name);
  const idValid = id === "" ? !idRequired : SEMANTIC_ID_PATTERN.test(id);
  /** More than an import takes: refused here, before a byte of it is sent. */
  const tooLarge = file !== null && file.size > AGENT_ARCHIVE_MAX_UPLOAD_BYTES;
  const limit = formatBytes(AGENT_ARCHIVE_MAX_UPLOAD_BYTES);
  /** Who the migration chat goes to; null in a Project with no Agent, which disables it. */
  const chatAgent = pickDefaultAgent(agents);
  /** Whether that Agent carries the Skill the prompt names (asked only where the section shows). */
  const porting = usePortingSkill(
    projectId,
    replace === undefined ? (chatAgent?.agentId ?? null) : null,
  );
  const prompt = migrationPrompt(framework, path, projectId);
  const home = SOURCE_HOME[framework];
  /** The Agent an overwrite replaces: this one in replace mode, else the one the 409 named. */
  const target = replace?.agentId ?? taken;

  /** Over to the chat: the source goes with it, so nothing typed is left to lose. */
  const goToChat = () => {
    if (prompt === null || chatAgent === null) return;
    discardUnsaved(form.scope);
    openAiChat({ agentId: chatAgent.agentId, text: prompt });
    onClose();
  };
  /** The same, through the guard: a picked file does not go with the chat, so it asks first. */
  const requestChat = useGuardedClose(goToChat, form.scope, { locked: uploading });
  const openChat = () => (file !== null ? requestChat() : goToChat());

  const installPorting = async () => {
    if (chatAgent === null) return;
    if (await porting.install()) {
      toastSuccess(
        `${S.plugins.installedToast(PORTING_PLUGIN, agentDisplayName(chatAgent))}${S.agent.takesEffectSuffix}`,
      );
    }
    // The Agent's Skill count moved; its card reads the list.
    void reloadAgents().catch(() => {});
  };

  /** A picked file suggests the id from its name (the export's `<id>-<yyyymmdd>.zip`). */
  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const derived = agentIdFromArchiveName(picked.name);
    form.patch({ file: picked, agentId: SEMANTIC_ID_PATTERN.test(derived) ? derived : "" });
    setTaken(null);
    setRefusal(null);
  };

  /**
   * Uploads the picked file under `as` (absent: the id the file records), replacing that Agent's
   * State with `overwrite`. A taken id without it shows in place; any other refusal under the
   * button. Landed, the dialog is done with: it says what came in and hands over.
   */
  const send = async (overwrite: boolean, as: string | null) => {
    if (file === null || tooLarge || uploading) return;
    setUploading(true);
    setRefusal(null);
    try {
      const res = await uploadArchive<AgentArchiveImportResponse>(
        api.agentImportUrl(
          projectId,
          { ...(as !== null && as !== "" ? { agentId: as } : {}), overwrite },
          machineId,
        ),
        file,
      );
      setConfirming(false);
      discardUnsaved(form.scope);
      toastSuccess(importReportText(res, agentDisplayName(res.agent)));
      // A machine's list is that machine's own: the caller reads it.
      if (machineId === null) void reloadAgents().catch(() => {});
      onImported(res);
    } catch (e) {
      setConfirming(false);
      if (!overwrite && e instanceof ApiError && e.status === 409 && e.code === "agent_exists") {
        setTaken(e.details?.agentId ?? as ?? "");
      } else {
        setRefusal(apiErrorText(e));
      }
    } finally {
      setUploading(false);
    }
  };

  /** The confirmation's action: the same file again, replacing the State of `target`. */
  const overwriteFromFile = () => void send(true, target);

  /** "Use another id": the id field, its text selected for typing over. */
  const focusId = () => {
    const field = document.getElementById(idFieldId);
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  };

  const pathLabel = framework === "other" ? S.agent.migratePathOther : S.agent.migratePath;

  return (
    <>
      <Modal
        open
        title={replace === undefined ? S.agent.importAgent : S.agent.replaceTitle(replace.name)}
        onClose={requestClose}
        widthClass="sm:max-w-lg"
      >
        <div className="space-y-4">
          {replace === undefined && (
            <section>
              <h3 className="flex items-center gap-1 text-sm font-medium">
                {S.agent.migrateTitle}
                <InfoPopover label={S.agent.migrateTitle}>{S.agent.migrateInfo}</InfoPopover>
              </h3>
              <div className="mt-2.5 space-y-3">
                <Select
                  size="sm"
                  label={S.agent.migrateFramework}
                  value={framework}
                  disabled={uploading}
                  onChange={(e) => form.patch({ framework: e.target.value as MigrationSource })}
                >
                  {MIGRATION_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {S.agent.migrateFrameworks[source]}
                    </option>
                  ))}
                </Select>
                <Input
                  size="sm"
                  label={pathLabel}
                  required={home === null}
                  value={path}
                  placeholder={home ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => form.patch({ path: e.target.value })}
                />
                <PromptFold
                  text={prompt ?? S.agent.migratePrompt(null, S.agent.migratePathToken, projectId)}
                />
                {chatAgent !== null &&
                  (porting.status === "missing" || porting.status === "installing") && (
                    <div role="status" className="space-y-1 text-xs">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className={toneInk.attention}>
                          {S.agent.migrateSkillMissing(agentDisplayName(chatAgent))}
                        </span>
                        <Button
                          size="sm"
                          variant="link"
                          disabled={porting.status === "installing"}
                          aria-busy={porting.status === "installing"}
                          onClick={() => void installPorting()}
                        >
                          {porting.status === "installing"
                            ? S.agent.migrateSkillInstalling
                            : S.agent.migrateSkillInstall}
                        </Button>
                      </p>
                      {porting.installError !== null && (
                        <p className={toneInk.danger}>{porting.installError}</p>
                      )}
                    </div>
                  )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      prompt === null || chatAgent === null || porting.holdsChat || uploading
                    }
                    onClick={openChat}
                  >
                    {S.skills.importOpenChat}
                  </Button>
                </div>
              </div>
            </section>
          )}

          <section
            className={
              replace === undefined ? "border-t border-gray-200 pt-4 dark:border-gray-800" : ""
            }
          >
            <h3 className="flex items-center gap-1 text-sm font-medium">
              {S.agent.importFileTitle}
              <InfoPopover label={S.agent.importFileTitle}>
                {replace === undefined ? S.agent.importFileInfo : S.agent.replaceFileInfo}
              </InfoPopover>
            </h3>
            <div className="mt-2.5 space-y-3">
              <div>
                {file === null ? (
                  <label
                    className={`${ARCHIVE_BUTTON_CLASS} ${uploading ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <HiddenFileInput
                      accept={ARCHIVE_ACCEPT}
                      disabled={uploading}
                      onChange={onPickFile}
                    />
                    {S.agent.importPick}
                  </label>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      data-tooltip={S.agent.importClearFile}
                      aria-label={S.agent.importClearFile}
                      disabled={uploading}
                      onClick={() => {
                        form.patch({ file: null, agentId: "" });
                        setTaken(null);
                        setRefusal(null);
                      }}
                      className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                )}
                {tooLarge ? (
                  <FieldError>{S.agent.importTooLarge(limit)}</FieldError>
                ) : (
                  <FieldHint>{S.agent.importFileHint(limit)}</FieldHint>
                )}
              </div>
              {replace === undefined && file !== null && (
                <div>
                  <Input
                    id={idFieldId}
                    size="sm"
                    label={S.agent.id}
                    required={idRequired}
                    value={agentId}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={uploading}
                    onChange={(e) => {
                      form.patch({ agentId: e.target.value });
                      setTaken(null);
                    }}
                    {...(idValid
                      ? { hint: idRequired ? S.agent.importIdHintTar : S.agent.importIdHint }
                      : { error: id === "" ? S.agent.importIdHintTar : S.agent.idHint })}
                  />
                  {taken !== null && (
                    <p
                      role="alert"
                      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                    >
                      <span className={toneInk.attention}>{S.agent.importExists(taken)}</span>
                      <Button size="sm" variant="link" onClick={focusId}>
                        {S.agent.importRename}
                      </Button>
                      {isOwner && (
                        <Button size="sm" variant="link" onClick={() => setConfirming(true)}>
                          {S.agent.importOverwrite}
                        </Button>
                      )}
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={file === null || tooLarge || !idValid || uploading}
                  aria-busy={uploading}
                  onClick={() =>
                    replace === undefined ? void send(false, id) : setConfirming(true)
                  }
                >
                  {uploading
                    ? S.agent.importing
                    : replace === undefined
                      ? S.agent.importAction
                      : S.agent.replaceAction}
                </Button>
              </div>
              {refusal !== null && (
                <p role="alert" className={`text-xs ${toneInk.danger}`}>
                  {refusal}
                </p>
              )}
            </div>
          </section>
        </div>
      </Modal>

      {/* The one confirmation before a State is replaced: the dialog stays beneath, so Cancel
          returns to it; confirming sends the same file with overwrite. */}
      <ConfirmModal
        open={confirming && file !== null && target !== null}
        title={S.agent.overwriteTitle}
        tone="danger"
        busy={uploading}
        confirmLabel={replace === undefined ? S.agent.importOverwrite : S.agent.replaceAction}
        cancelLabel={S.common.cancel}
        onClose={() => setConfirming(false)}
        onConfirm={overwriteFromFile}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {file !== null && target !== null ? S.agent.overwriteBody(target, file.name) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
