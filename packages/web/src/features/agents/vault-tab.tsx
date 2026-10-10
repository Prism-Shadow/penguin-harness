/**
 * Agent settings page "Vault" tab: an Agent-level key-value vault
 * (agent_state/.vault.toml) — a table (key, masked value, delete) plus an "Add" dialog
 * (vault-add-dialog.tsx: key + value, value uses a password field). Saving goes through PUT with
 * whole-table replace semantics: keys absent from the body are deleted, and
 * resending only the key name means keep the original value (plaintext never comes
 * back to the frontend); only owners can edit, members are read-only.
 * The key name is injected into the Agent's system prompt to inform the model; the
 * value is injected only into the exec_command subprocess environment, never into
 * the model context.
 *
 * Prompt-injection controls (usePromptInjection): the vault.enabled switch, the
 * {{VAULT}}-placeholder alert (with legacy-template migration) and the editable
 * vault.prompt section, mirroring the Memory tab — owner-only, like the table edits.
 */
import { useCallback, useEffect, useState } from "react";
import type { VaultEntryInfo, VaultUpdateRequest } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  HelpFold,
  NoticeStrip,
  SettingsEmpty,
  SkeletonList,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { usePromptInjection } from "./prompt-injection-controls";
import { AiCreateModal } from "../ai-create";
import { AiCreateButtons } from "../ai-create/ai-create-buttons";
import { VaultAddDialog } from "./vault-add-dialog";

export function VaultTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes (toggle / prompt / placeholder insert) happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: () => void;
}) {
  const { currentProject, agents, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  // Prompt-injection controls follow the tab's existing gate: owner-only edits.
  const { applyConfig, toggleCard, alertStrip, promptSection } = usePromptInjection({
    agentId,
    feature: "vault",
    strings: S.vault.injection,
    canEdit: isOwner,
    onConfigChanged,
  });

  const [entries, setEntries] = useState<VaultEntryInfo[] | null>(null);
  // Tab-level error is only the initial load failure; saves/deletes report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Add dialog: its form, its errors and its overwrite question travel with it (vault-add-dialog.tsx).
  const [adding, setAdding] = useState(false);
  /** "Add with AI" dialog: its prompt goes to the Project's default agent, naming this agent as the target. */
  const [aiAdding, setAiAdding] = useState(false);
  // Key pending deletion confirmation (non-null shows the confirm modal).
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setEntries(null);
    setError(null);
    try {
      // The injection controls' state loads in parallel with the tab's own table.
      const [res, configView] = await Promise.all([
        api.getVault(projectId, agentId),
        api.getAgentConfig(projectId, agentId),
      ]);
      setEntries(res.entries);
      applyConfig(configView.config);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Persist a change immediately (add / delete): returns null on success, an error message on failure — the caller decides whether it lands inside the modal or at the tab level. */
  const persist = async (body: VaultUpdateRequest): Promise<string | null> => {
    if (!projectId || !agentId) return S.common.unknownError;
    setBusy(true);
    try {
      const res = await api.putVault(projectId, agentId, body);
      setEntries(res.entries);
      toastSuccess(S.agent.savedTakesEffect);
      // Add / delete moves the agent card's vault-key count; refresh the list provider too.
      void reloadAgents();
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
    }
  };

  /** Keep existing keys (resending only the key name = keep the original value), excluding excludeKey. */
  const keepEntries = (excludeKey?: string) =>
    (entries ?? [])
      .filter((e) => e.key !== excludeKey)
      .map((e): VaultUpdateRequest["entries"][number] => ({ key: e.key }));

  /**
   * The add dialog's write. Upsert by key name: the existing entry is not resent beside the new
   * one, which PUT's duplicate-key validation would refuse.
   */
  const addEntry = (key: string, value: string) =>
    persist({ entries: [...keepEntries(key), { key, value }] });

  /** Confirm modal's "Confirm": closes the modal after deletion; a failure pops a toast. */
  const confirmRemove = async () => {
    if (deleting === null) return;
    const err = await persist({ entries: keepEntries(deleting) });
    if (err !== null) toastError(err);
    setDeleting(null);
  };

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      {/* What the vault is and when a value takes effect is read once and then in the way; the
          table below is what the tab is for. The panel repeats no title — the tab bar carries it —
          so the disclosure names itself instead of hanging a "?" off nothing. */}
      <HelpFold label={S.agent.tabVault}>
        {S.vault.desc}
        {!isOwner && <span className="mt-1.5 block">{S.vault.readOnlyHint}</span>}
      </HelpFold>

      {toggleCard}
      {alertStrip}

      {entries === null ? (
        <SkeletonList rows={4} />
      ) : entries.length === 0 ? (
        <SettingsEmpty>{S.vault.empty}</SettingsEmpty>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <th className="px-3 py-2.5">{S.vault.key}</th>
                <th className="px-3 py-2.5">{S.vault.valueMasked}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.key}
                  className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                >
                  <td className="px-3 py-2 font-mono text-xs">{entry.key}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {entry.valueMasked}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDeleting(entry.key)}
                      >
                        {S.vault.remove}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add entry points (owner): two separate buttons. The manual one opens the form in a modal
          (submitting the same key name overwrites the original value), the AI one the prompt. */}
      {isOwner && entries !== null && (
        <AiCreateButtons
          size="sm"
          disabled={busy}
          onAi={() => setAiAdding(true)}
          onManual={() => setAdding(true)}
        />
      )}

      {promptSection}

      <VaultAddDialog
        open={adding}
        existingKeys={(entries ?? []).map((e) => e.key)}
        onAdd={addEntry}
        onClose={() => setAdding(false)}
      />

      {/* The AI path. Its lead is an honest warning: a value typed into the prompt is recorded in
          the conversation's Trace, whereas a value typed into the form never leaves the vault. The
          dialog's one exit already agrees with that warning — the prompt lands in a composer and is
          read once more before anything carries it to a provider. */}
      <AiCreateModal
        open={aiAdding}
        onClose={() => setAiAdding(false)}
        title={S.vault.aiAddTitle}
        intro={
          <NoticeStrip tone="attention" className="rounded-md border px-2.5 py-1.5">
            {S.vault.aiAddIntro}
          </NoticeStrip>
        }
        placeholder={S.vault.aiAddPlaceholder}
        examples={S.vault.aiAddExamples}
        tail={S.vault.aiAddTail(agentId, projectId)}
        agents={agents}
      />

      {/* Delete confirmation (shared ConfirmModal, same pattern as Agent / Session deletion). */}
      <ConfirmModal
        open={deleting !== null}
        title={S.vault.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmRemove()}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.vault.deleteConfirm(deleting) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
