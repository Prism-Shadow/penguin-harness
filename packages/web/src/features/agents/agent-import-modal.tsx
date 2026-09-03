/**
 * The Agents page's "Import agent" dialog, in two segments: a portable bundle (or a bare
 * penguin-agent.json) picked from disk and posted to the import route, or a prompt handed to
 * the Project's default agent, which reads a Claude Code / Codex / Pi setup or a bundle with
 * the agent-porting skill and runs the import itself. Apart from the snapshot import on the
 * settings page on purpose: a snapshot restores one existing agent's state, this creates one.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { Button } from "../../components/ui/button";
import { FieldHint, FieldLabel } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { CloseIcon, MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Segmented } from "../../components/ui/segmented";
import { toastInfo, toastSuccess } from "../../components/ui/toast";
import { AiCreatePanel, composeAiPrompt, pickDefaultAgent, useAiBridge } from "../ai-create";
import { AGENT_BUNDLE_ACCEPT, agentIdFromBundleName } from "./agent-bundle-file";
import { SNAPSHOT_BUTTON_CLASS, fileToBase64 } from "./snapshot-file";

type ImportMode = "file" | "ai";

export interface AgentImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  agents: readonly AgentSummary[];
  /** After a file import landed: the new agent's id. The caller closes the dialog and reloads. */
  onImported: (agentId: string) => void;
}

export function AgentImportModal(props: AgentImportModalProps) {
  // Mounted only while open, so every open starts on the file segment with an empty form.
  return props.open ? <AgentImportDialog {...props} /> : null;
}

function AgentImportDialog({
  open,
  onClose,
  projectId,
  agents,
  onImported,
}: AgentImportModalProps) {
  const [mode, setMode] = useState<ImportMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [agentId, setAgentId] = useState("");
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [pickedAgent, setPickedAgent] = useState<string | null>(null);
  const { openAiChat } = useAiBridge();
  const aiAgentId = pickedAgent ?? pickDefaultAgent(agents)?.agentId ?? null;
  const tail = S.agent.aiImportTail(projectId);
  const aiReady = aiAgentId !== null && draft.trim() !== "";

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setFile(picked);
    setError(null);
    setIdError(undefined);
    // Suggest the id from the file name (exported as <agentId>-export.zip) while the field is
    // still empty; the suggestion stays editable, an unusable derivation is dropped.
    if (!agentId.trim()) {
      const derived = agentIdFromBundleName(picked.name);
      if (SEMANTIC_ID_PATTERN.test(derived)) setAgentId(derived);
    }
  };

  const runImport = async () => {
    if (file === null) return;
    const id = agentId.trim();
    if (id !== "" && !SEMANTIC_ID_PATTERN.test(id)) {
      setIdError(S.agent.idHint);
      return;
    }
    setBusy(true);
    setError(null);
    setIdError(undefined);
    try {
      const res = await api.importAgentBundle(projectId, {
        dataBase64: await fileToBase64(file),
        ...(id !== "" ? { agentId: id } : {}),
      });
      toastSuccess(S.agent.importAgentDone(res.agent.agentId));
      if (res.skipped.length > 0) toastInfo(S.agent.importAgentSkipped(res.skipped.join(" ")));
      if (res.vaultKeys.length > 0) {
        toastInfo(S.agent.importAgentVaultKeys(res.vaultKeys.join(", ")));
      }
      onImported(res.agent.agentId);
    } catch (e) {
      // A taken id is answered in place: the id field becomes the retry.
      if (e instanceof ApiError && e.status === 409 && e.code === "agent_exists") {
        setIdError(S.agent.importAgentExists);
      } else {
        setError(apiErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const go = (autoSend: boolean) => {
    if (aiAgentId === null) return;
    openAiChat({ agentId: aiAgentId, text: composeAiPrompt(draft, tail), autoSend });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={S.agent.importAgent}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        mode === "file" ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={file === null || busy}
              onClick={() => void runImport()}
            >
              {busy ? S.agent.importAgentBusy : S.agent.importAgentAction}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{S.common.cancel}</Button>
            <Button disabled={!aiReady} onClick={() => go(false)}>
              {S.aiCreate.editInChat}
            </Button>
            <Button variant="primary" disabled={!aiReady} onClick={() => go(true)}>
              <GlyphIcon d={MAGIC_WAND_ICON} />
              {S.aiCreate.send}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agent.importAgentDesc}</p>
        <Segmented
          cols={2}
          value={mode}
          onChange={setMode}
          options={[
            { value: "file", label: S.agent.importModeFile },
            { value: "ai", label: S.agent.importModeAi },
          ]}
        />
        {mode === "file" ? (
          <div className="space-y-3">
            <div>
              <FieldLabel>{S.agent.importFileLabel}</FieldLabel>
              {file === null ? (
                <label
                  className={`${SNAPSHOT_BUTTON_CLASS} ${busy ? "pointer-events-none opacity-60" : ""}`}
                >
                  <HiddenFileInput
                    accept={AGENT_BUNDLE_ACCEPT}
                    disabled={busy}
                    onChange={onPickFile}
                  />
                  {S.agent.importFilePick}
                </label>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate rounded-md border border-gray-300 bg-gray-50 px-2.5 py-1 font-mono text-xs dark:border-gray-700 dark:bg-gray-900">
                    {file.name}
                  </span>
                  <button
                    type="button"
                    title={S.agent.importFileClear}
                    aria-label={S.agent.importFileClear}
                    disabled={busy}
                    onClick={() => setFile(null)}
                    className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              )}
              <FieldHint>{S.agent.importFileHint}</FieldHint>
            </div>
            <Input
              size="sm"
              label={S.agent.id}
              {...(idError === undefined
                ? { hint: S.agent.importAgentIdHint }
                : { error: idError })}
              value={agentId}
              disabled={busy}
              autoComplete="off"
              onChange={(e) => {
                setAgentId(e.target.value);
                setIdError(undefined);
              }}
            />
            {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          <AiCreatePanel
            value={draft}
            onChange={setDraft}
            intro={S.agent.aiImportIntro}
            examples={[...S.agent.aiImportExamples]}
            tail={tail}
            agents={agents}
            agentId={aiAgentId}
            onAgentChange={setPickedAgent}
            allowAgentChoice
          />
        )}
      </div>
    </Modal>
  );
}
