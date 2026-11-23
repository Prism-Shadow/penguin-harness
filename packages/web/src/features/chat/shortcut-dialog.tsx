import { useState } from "react";
import {
  Button,
  Input,
  Modal,
  Textarea,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  SHORTCUT_PROMPT_MAX,
  SHORTCUT_TITLE_MAX,
  shortcutDraftError,
  type ShortcutDraft,
} from "./user-shortcuts";

/**
 * The create / edit dialog. It opens on the shortcut being edited, or on a new one already
 * filled from the composer — that prefill is where it starts, so closing it untouched asks
 * nothing, and a valid new shortcut can be saved as it stands. Save waits for its write: a
 * refused one leaves the dialog open with what was typed.
 */
export function ShortcutDialog({
  opening,
  onClose,
  onSave,
}: {
  opening: ShortcutDraft;
  onClose: () => void;
  onSave: (draft: ShortcutDraft) => Promise<boolean>;
}) {
  const form = useFormDraft(opening, {
    normalize: (d) => ({ id: d.id, title: d.title.trim(), prompt: d.prompt.trim() }),
  });
  const draft = form.draft;
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const editing = draft.id !== null;
  const draftError = shortcutDraftError(draft);
  // A new shortcut is a change on its own; an edit has to change something.
  const canSave = draftError === null && (!editing || form.dirty) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    // On success the host closes the dialog; a refused write leaves the typing as it was.
    if (!(await onSave(draft))) setBusy(false);
  };

  return (
    <Modal
      open
      title={editing ? S.chat.shortcuts.editTitle : S.chat.shortcuts.createTitle}
      onClose={requestClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          size="sm"
          label={S.chat.shortcuts.titleLabel}
          hint={S.chat.shortcuts.titleHint(SHORTCUT_TITLE_MAX)}
          error={
            draftError === "titleTooLong"
              ? S.chat.shortcuts.titleTooLong(SHORTCUT_TITLE_MAX)
              : undefined
          }
          value={draft.title}
          autoFocus
          maxLength={SHORTCUT_TITLE_MAX}
          onChange={(e) => form.patch({ title: e.target.value })}
        />
        <Textarea
          label={S.chat.shortcuts.promptLabel}
          info={S.chat.shortcuts.promptInfo}
          infoLabel={S.common.moreInfoAbout(S.chat.shortcuts.promptLabel)}
          hint={S.chat.shortcuts.promptHint(SHORTCUT_PROMPT_MAX)}
          error={
            draftError === "promptTooLong"
              ? S.chat.shortcuts.promptTooLong(SHORTCUT_PROMPT_MAX)
              : undefined
          }
          value={draft.prompt}
          rows={8}
          size="sm"
          maxLength={SHORTCUT_PROMPT_MAX}
          onChange={(e) => form.patch({ prompt: e.target.value })}
        />
      </div>
    </Modal>
  );
}
