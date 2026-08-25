/**
 * Trace import (System settings → General): a `.jsonl` Trace exported from another install
 * becomes a conversation of the chosen Agent.
 *
 * The endpoint is per-Agent and the row has to ask which one: a Trace file's own
 * `session_meta` cannot name a local Agent — its `agent_state` path belongs to the machine
 * that exported it. Picking a file IS the confirmation, so there is no second button.
 *
 * It sits beside the CLI-sessions filter because both decide what the conversation list
 * holds. Export is deliberately not here: a Trace is downloaded from the conversation it
 * belongs to, in the chat's Trace panel.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { UploadIcon } from "../../components/ui/icons";
import { Select } from "../../components/ui/select";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { PrefRow } from "./setting-row";

/** Client-side pre-check before reading the picked file (the same cap as the server's import route). */
const MAX_TRACE_BYTES = 14 * 1024 * 1024;

export function TraceImportRow() {
  const { currentProject, agents } = useProject();
  const { reload } = useSessions();
  const [selected, setSelected] = useState("");
  const [importing, setImporting] = useState(false);
  const projectId = currentProject?.projectId ?? null;
  /** The Agent that receives the file: the explicit pick, else the first one listed. */
  const agentId = selected !== "" ? selected : (agents[0]?.agentId ?? "");

  const runImport = async (dataBase64: string) => {
    if (projectId === null || agentId === "") return;
    setImporting(true);
    try {
      await api.importAgentTrace(projectId, agentId, { dataBase64 });
      // The imported Session is a conversation like any other: refresh the list so it
      // appears in the sidebar behind the dialog, where the user opens it.
      await reload();
      toastSuccess(S.settings.importTraceDone);
    } catch (e: unknown) {
      // Transient action failure → toast (the app's one notification rule).
      toastError(apiErrorText(e));
    } finally {
      setImporting(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (!file || agentId === "") return;
    if (file.size > MAX_TRACE_BYTES) {
      toastError(S.settings.importTraceTooLarge);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      void runImport(url.slice(url.indexOf(",") + 1)); // strip the data:...;base64, prefix
    };
    reader.onerror = () => toastError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <PrefRow label={S.settings.importTrace} info={S.settings.importTraceInfo}>
      <div className="flex items-center gap-2">
        <Select
          size="sm"
          value={agentId}
          disabled={importing || agents.length === 0}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={S.settings.importTraceAgent}
        >
          {agents.map((a) => (
            <option key={a.agentId} value={a.agentId}>
              {agentDisplayName(a)}
            </option>
          ))}
        </Select>
        {/* The file pick doubles as the confirm action (button styling on a label, so the
            native picker opens without a detour). */}
        <label
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1 text-sm font-medium transition-colors duration-150 dark:border-gray-700 ${
            importing || agents.length === 0
              ? "pointer-events-none opacity-60"
              : "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          <HiddenFileInput
            accept=".jsonl"
            disabled={importing || agents.length === 0}
            onChange={onPickFile}
          />
          <UploadIcon size={14} />
          {importing ? S.settings.importTraceRunning : S.settings.importTracePick}
        </label>
      </div>
    </PrefRow>
  );
}
