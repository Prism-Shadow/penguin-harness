/**
 * Agent settings page "Vault" tab: an Agent-level key-value vault
 * (agent_state/.vault.toml) — a table (key, masked value, delete) plus an "Add" modal
 * (key + value, value uses a password field). Saving goes through PUT with
 * whole-table replace semantics: keys absent from the body are deleted, and
 * resending only the key name means keep the original value (plaintext never comes
 * back to the frontend); only owners can edit, members are read-only.
 * The key name is injected into the Agent's system prompt to inform the model; the
 * value is injected only into the exec_command subprocess environment, never into
 * the model context.
 */
import { useCallback, useEffect, useState } from "react";
import type { VaultEntryInfo, VaultUpdateRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PasswordInput } from "../../components/ui/password-input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";

/** Vault key naming rule (consistent with core/server): shell environment variable name. */
const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function VaultTab({ agentId }: { agentId: string }) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";

  const [entries, setEntries] = useState<VaultEntryInfo[] | null>(null);
  // Tab-level error is only the initial load failure; saves/deletes report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Add modal: form state and per-field errors travel with the modal (a tab-level error would be hidden behind it).
  const [adding, setAdding] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [addErrors, setAddErrors] = useState<{ key?: string; value?: string }>({});
  const clearAddErrors = () => setAddErrors((p) => (p.key || p.value ? {} : p));
  // Key pending deletion confirmation (non-null shows the confirm modal).
  const [deleting, setDeleting] = useState<string | null>(null);
  // Existing key pending overwrite confirmation (adding a key that's already configured replaces its value).
  const [overwriting, setOverwriting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setEntries(null);
    setError(null);
    try {
      const res = await api.getVault(projectId, agentId);
      setEntries(res.entries);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

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
      toastSuccess(S.common.saved);
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

  /** Open the add modal (reset form and error state). */
  const openAdd = () => {
    setKeyInput("");
    setValueInput("");
    setAddErrors({});
    setAdding(true);
  };

  const addEntry = async () => {
    const key = keyInput.trim();
    const next: { key?: string; value?: string } = {};
    if (!key) next.key = S.common.requiredField;
    else if (!VAULT_KEY_PATTERN.test(key)) next.key = S.vault.keyInvalid;
    if (!valueInput) next.value = S.vault.valueRequired;
    if (next.key || next.value) {
      setAddErrors(next);
      return;
    }
    setAddErrors({});
    // Submitting an already-configured key overwrites its value (unrecoverable): confirm first.
    if (overwriting !== key && (entries ?? []).some((e) => e.key === key)) {
      setOverwriting(key);
      return;
    }
    setOverwriting(null);
    // Upsert by same key name: don't resend the existing entry too, to avoid a 400 from PUT's duplicate-key validation.
    const err = await persist({ entries: [...keepEntries(key), { key, value: valueInput }] });
    if (err !== null) {
      // Server rejection (e.g. duplicate key) — surface it on the key field.
      setAddErrors({ key: err });
      return;
    }
    setAdding(false);
  };

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
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.vault.desc}</p>
        {!isOwner && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{S.vault.readOnlyHint}</p>
        )}
      </div>

      {entries === null ? (
        <SkeletonList rows={4} />
      ) : entries.length === 0 ? (
        // Plain-text empty state (settings area doesn't use the penguin-icon EmptyState, keeps the same gray level as the table area).
        <p className="py-2 text-xs text-gray-400 dark:text-gray-500">{S.vault.empty}</p>
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

      {/* Add entry point (owner): the form lives in a modal; submitting the same key name overwrites the original value. */}
      {isOwner && entries !== null && (
        <Button size="sm" variant="primary" disabled={busy} onClick={openAdd}>
          {S.vault.add}
        </Button>
      )}

      <Modal
        open={adding}
        title={S.vault.addTitle}
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void addEntry()}>
              {S.vault.add}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            size="sm"
            label={S.vault.key}
            required
            hint={S.vault.keyHint}
            error={addErrors.key}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              clearAddErrors();
            }}
            className="font-mono"
            placeholder="OPENAI_API_KEY"
            autoComplete="off"
          />
          <PasswordInput
            size="sm"
            label={S.vault.value}
            required
            error={addErrors.value}
            value={valueInput}
            onChange={(e) => {
              setValueInput(e.target.value);
              clearAddErrors();
            }}
            className="font-mono"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void addEntry();
            }}
          />
        </div>
      </Modal>

      {/* Overwrite confirmation: the add modal stays underneath, so cancel returns to the form. */}
      <ConfirmModal
        open={overwriting !== null}
        title={S.vault.overwriteTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => setOverwriting(null)}
        onConfirm={() => void addEntry()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.vault.overwriteConfirm(overwriting) : ""}
        </p>
      </ConfirmModal>

      {/* Delete confirmation (shared ConfirmModal, same pattern as Agent / Session deletion). */}
      <ConfirmModal
        open={deleting !== null}
        title={S.vault.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.vault.deleteConfirm(deleting) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
