/**
 * "Import agent" (the Agents page) and, in replace mode, "Replace from file…" (the settings page):
 * migrate another framework's agent through a chat with the default agent (giving it the
 * agent-porting Skill first; an update over Skills it already has asks), or upload an exported
 * file as it is. A taken id offers another id and, to the owner, an overwrite behind one danger
 * confirmation. What was typed or picked is a draft: closing with it asks first.
 */
import { useId, useState, type ChangeEvent } from "react";
import {
  Button,
  ConfirmModal,
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
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { toneInk } from "../../lib/tone";
import { toastApiError } from "../../lib/toast-api-error";
import { agentDisplayName, useProject } from "../../state/project";
import { PromptFold, pickDefaultAgent, useAiBridge } from "../ai-create";
import { ARCHIVE_ACCEPT, ARCHIVE_BUTTON_CLASS, agentIdFromArchiveName } from "./archive-file";
import {
  MIGRATION_SOURCES,
  PORTING_PLUGIN,
  installPorting,
  migrationPrompt,
  portingNeed,
  sourceOf,
  type MigrationSource,
} from "./agent-migration";

export interface AgentImportDialogProps {
  projectId: string;
  /** Replace mode: the Agent whose State the file replaces. Absent, the dialog creates an Agent. */
  replace?: { agentId: string; name: string };
  /** The server the file goes to; null for this one. */
  machineId: string | null;
  onClose: () => void;
  /** An import landed: the dialog has said so and read this server's Agent list again. */
  onImported?: () => void;
}

interface ImportDraft {
  framework: MigrationSource;
  path: string;
  file: File | null;
  agentId: string;
}

/** What the draft is compared by: the text trimmed, the file by what identifies it. */
const normalize = (d: ImportDraft) => ({
  ...d,
  path: d.path.trim(),
  agentId: d.agentId.trim(),
  file: d.file && [d.file.name, d.file.size, d.file.lastModified],
});

export function AgentImportDialog(props: AgentImportDialogProps) {
  const { projectId, replace, machineId, onClose, onImported } = props;
  const { currentProject, agents, reloadAgents } = useProject();
  const { openAiChat } = useAiBridge();
  const form = useFormDraft<ImportDraft>(
    { framework: "claude-code", path: "", file: null, agentId: "" },
    { normalize },
  );
  const { framework, path, file, agentId } = form.draft;
  const [busy, setBusy] = useState(false);
  /** The id a 409 `agent_exists` named; cleared by the next edit of the id or the file. */
  const [taken, setTaken] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The plugin update the chat waits on, which overwrites the Agent's copies of its Skills. */
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const idFieldId = useId();
  const id = replace?.agentId ?? agentId.trim();
  const chatAgent = pickDefaultAgent(agents);
  const prompt = migrationPrompt(framework, path, projectId);
  const home = sourceOf(framework)?.home;

  /** `updateConfirmed`: the update confirmation was answered. */
  const openChat = async (updateConfirmed = false) => {
    if (prompt === null || chatAgent === null) return;
    setBusy(true);
    try {
      const need = updateConfirmed ? "update" : await portingNeed(projectId, chatAgent.agentId);
      if (need === "update" && !updateConfirmed) {
        setConfirmingUpdate(true);
        setBusy(false);
        return;
      }
      if (need !== "ready") {
        await installPorting(projectId, chatAgent.agentId);
        toastSuccess(S.plugins.installedToast(PORTING_PLUGIN, agentDisplayName(chatAgent)));
      }
      discardUnsaved(form.scope);
      openAiChat({ agentId: chatAgent.agentId, text: prompt });
      onClose();
    } catch (e) {
      toastApiError(e);
      setBusy(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    form.patch({ file: picked, agentId: agentIdFromArchiveName(picked.name) });
    setTaken(null);
  };

  /** Uploads the file as Agent `id`; `overwrite` replaces that Agent's State. */
  const send = async (overwrite: boolean) => {
    if (file === null) return;
    setBusy(true);
    try {
      const res = await api.importAgentArchive(
        projectId,
        file,
        { agentId: id, overwrite },
        machineId,
      );
      const name = res.agent.name ?? res.agent.agentId;
      const { imported, skipped } = res.sessions;
      toastSuccess(S.agent.importDone(name, res.mode === "overwritten", imported, skipped.length));
      discardUnsaved(form.scope);
      if (machineId === null) void reloadAgents().catch(() => {});
      onImported?.();
      onClose();
    } catch (e) {
      if (!overwrite && e instanceof ApiError && e.code === "agent_exists") {
        setTaken(e.details?.agentId ?? id);
      } else toastApiError(e);
      setBusy(false);
      setConfirming(false);
    }
  };
  const updatePortingAndChat = () => void openChat(true);
  /** The confirmation's action: the same file again, replacing the existing Agent's State. */
  const overwriteFromFile = () => void send(true);

  return (
    <>
      <Modal
        open
        title={replace ? S.agent.replaceTitle(replace.name) : S.agent.importAgent}
        onClose={requestClose}
        widthClass="sm:max-w-lg"
      >
        <div className="space-y-4">
          {!replace && (
            <section className="space-y-3">
              <h3 className="flex items-center gap-1 text-sm font-medium">
                {S.agent.migrateTitle}
                <InfoPopover label={S.agent.migrateTitle}>{S.agent.migrateInfo}</InfoPopover>
              </h3>
              <Select
                size="sm"
                label={S.agent.migrateFramework}
                value={framework}
                onChange={(e) => form.patch({ framework: e.target.value as MigrationSource })}
              >
                {MIGRATION_SOURCES.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
                <option value="other">{S.agent.migrateOther}</option>
              </Select>
              <Input
                size="sm"
                label={home ? S.agent.migratePath : S.agent.migratePathOther}
                required={!home}
                value={path}
                placeholder={home ?? ""}
                onChange={(e) => form.patch({ path: e.target.value })}
              />
              <PromptFold text={prompt ?? S.agent.migratePrompt(null, "…", projectId)} />
              <Button
                size="sm"
                variant="primary"
                disabled={prompt === null || chatAgent === null || busy}
                onClick={() => void openChat()}
              >
                {S.skills.importOpenChat}
              </Button>
            </section>
          )}
          <section
            className={`space-y-3 ${replace ? "" : "border-t border-gray-200 pt-4 dark:border-gray-800"}`}
          >
            <h3 className="text-sm font-medium">{S.agent.importFileTitle}</h3>
            <div>
              <div className="flex min-w-0 items-center gap-2">
                <label className={`${ARCHIVE_BUTTON_CLASS} ${busy ? "pointer-events-none" : ""}`}>
                  <HiddenFileInput accept={ARCHIVE_ACCEPT} disabled={busy} onChange={onPickFile} />
                  {S.agent.importPick}
                </label>
                <span className="min-w-0 truncate font-mono text-xs">{file?.name}</span>
              </div>
              <FieldHint>{S.agent.importFileHint}</FieldHint>
            </div>
            {!replace && file !== null && (
              <div>
                <Input
                  id={idFieldId}
                  size="sm"
                  label={S.agent.id}
                  required
                  value={agentId}
                  onChange={(e) => {
                    form.patch({ agentId: e.target.value });
                    setTaken(null);
                  }}
                  {...(SEMANTIC_ID_PATTERN.test(id)
                    ? { hint: S.agent.idHint }
                    : { error: S.agent.idHint })}
                />
                {taken !== null && (
                  <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className={toneInk.attention}>{S.agent.importExists(taken)}</span>
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => document.getElementById(idFieldId)?.focus()}
                    >
                      {S.agent.importRename}
                    </Button>
                    {currentProject?.role === "owner" && (
                      <Button size="sm" variant="link" onClick={() => setConfirming(true)}>
                        {S.agent.importOverwrite}
                      </Button>
                    )}
                  </p>
                )}
              </div>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={file === null || !SEMANTIC_ID_PATTERN.test(id) || busy}
              onClick={() => (replace ? setConfirming(true) : void send(false))}
            >
              {busy ? S.agent.importing : replace ? S.agent.replaceAction : S.agent.importAction}
            </Button>
          </section>
        </div>
      </Modal>
      <ConfirmModal
        open={confirmingUpdate}
        title={S.plugins.updateConfirmTitle(PORTING_PLUGIN)}
        tone="primary"
        busy={busy}
        confirmLabel={S.skills.updateAction}
        cancelLabel={S.common.cancel}
        onClose={() => setConfirmingUpdate(false)}
        onConfirm={updatePortingAndChat}
      >
        <p className="text-sm text-fg-muted">{S.plugins.updateConfirmWarning(PORTING_PLUGIN)}</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirming && file !== null}
        title={S.agent.overwriteTitle}
        tone="danger"
        busy={busy}
        confirmLabel={replace ? S.agent.replaceAction : S.agent.importOverwrite}
        cancelLabel={S.common.cancel}
        onClose={() => setConfirming(false)}
        onConfirm={overwriteFromFile}
      >
        <p className="text-sm text-fg-muted">{S.agent.overwriteBody(id, file?.name ?? "")}</p>
      </ConfirmModal>
    </>
  );
}
