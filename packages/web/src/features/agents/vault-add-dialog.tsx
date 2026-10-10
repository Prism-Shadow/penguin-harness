/**
 * The Vault tab's "Add" dialog (vault-tab.tsx): one key and its value, written with the rest of
 * the vault kept as it is. A record dialog under the settings commit model — the dialog is one
 * form, Add is live only once the key keeps the naming rule and a value is typed, and closing it
 * with anything typed (Cancel, Esc, the ×, a press outside) asks before the typing is thrown
 * away. The form is mounted only while the dialog is open, so every opening starts empty.
 *
 * Adding a key that is already configured replaces its value, which cannot be undone, so it asks
 * first; Cancel there returns to the form. A rejection from the server lands under the key, and
 * the dialog stays open with what was typed.
 */
import { useState } from "react";
import {
  Button,
  ConfirmModal,
  Input,
  Modal,
  PasswordInput,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** Vault key naming rule (consistent with core/server): shell environment variable name. */
export const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface VaultEntryDraft {
  key: string;
  value: string;
}

const EMPTY: VaultEntryDraft = { key: "", value: "" };

/** What Add sends: the key trimmed, the value exactly as typed. */
const normalizeEntry = (draft: VaultEntryDraft): VaultEntryDraft => ({
  key: draft.key.trim(),
  value: draft.value,
});

export interface VaultAddDialogProps {
  open: boolean;
  /** The keys already configured: adding one of them overwrites its value, after a question. */
  existingKeys: readonly string[];
  /** Writes the entry; resolves with null when stored, else with why it was refused. */
  onAdd: (key: string, value: string) => Promise<string | null>;
  onClose: () => void;
}

export function VaultAddDialog(props: VaultAddDialogProps) {
  return props.open ? <VaultAddForm {...props} /> : null;
}

function VaultAddForm({ existingKeys, onAdd, onClose }: VaultAddDialogProps) {
  const form = useFormDraft(EMPTY, { normalize: normalizeEntry });
  const requestClose = useGuardedClose(onClose, form.scope);
  /** What the server refused, under the key. Cleared by the next keystroke. */
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The configured key the user is being asked to overwrite. */
  const [overwriting, setOverwriting] = useState<string | null>(null);

  const key = form.draft.key.trim();
  const keyBroken = key !== "" && !VAULT_KEY_PATTERN.test(key);
  const valid = VAULT_KEY_PATTERN.test(key) && form.draft.value !== "";

  const edit = (patch: Partial<VaultEntryDraft>) => {
    form.patch(patch);
    setRefused(null);
  };

  const write = async () => {
    setOverwriting(null);
    setBusy(true);
    try {
      const refusal = await onAdd(key, form.draft.value);
      if (refusal === null) onClose();
      else setRefused(refusal);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!form.dirty || !valid || busy) return;
    // An already-configured key is overwritten, which cannot be undone: ask first.
    if (existingKeys.includes(key)) setOverwriting(key);
    else void write();
  };

  return (
    <>
      <Modal
        open
        title={S.vault.addTitle}
        onClose={requestClose}
        footer={
          <>
            <Button size="sm" onClick={requestClose}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!form.dirty || !valid || busy}
              onClick={submit}
            >
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
            error={refused ?? (keyBroken ? S.vault.keyInvalid : undefined)}
            value={form.draft.key}
            onChange={(e) => edit({ key: e.target.value })}
            className="font-mono"
            placeholder="OPENAI_API_KEY"
            autoComplete="off"
          />
          <PasswordInput
            size="sm"
            label={S.vault.value}
            required
            value={form.draft.value}
            onChange={(e) => edit({ value: e.target.value })}
            className="font-mono"
            autoComplete="off"
            onKeyDown={(e) => {
              // A one-field submit: Enter is the Add button, under the same conditions.
              if (e.key === "Enter") submit();
            }}
          />
        </div>
      </Modal>

      {/* Overwrite confirmation: the add dialog stays underneath, so Cancel returns to the form. */}
      <ConfirmModal
        open={overwriting !== null}
        title={S.vault.overwriteTitle}
        tone="primary"
        confirmLabel={S.common.save}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => setOverwriting(null)}
        onConfirm={() => void write()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.vault.overwriteConfirm(overwriting) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
