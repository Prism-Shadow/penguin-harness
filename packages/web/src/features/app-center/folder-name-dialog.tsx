/**
 * Renaming a folder: one field under the settings commit model. Save is live once the name,
 * trimmed, is new and not empty; the one field means Enter saves; closing with a changed name
 * asks before it is thrown away. The form is mounted only while the dialog is open, so it always
 * starts from the folder's current name.
 */
import { Button, Input, Modal, useFormDraft, useGuardedClose } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

/** The layout's bound on a folder name, in characters (code points). */
export const FOLDER_NAME_MAX = 40;

export function FolderNameDialog({
  name,
  onSave,
  onClose,
}: {
  /** The folder's current name; null while the dialog is closed. */
  name: string | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  return name === null ? null : <FolderNameForm name={name} onSave={onSave} onClose={onClose} />;
}

function FolderNameForm({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const form = useFormDraft(name, { normalize: (value) => value.trim() });
  const requestClose = useGuardedClose(onClose, form.scope);
  const next = form.draft.trim();
  const valid = next !== "" && [...next].length <= FOLDER_NAME_MAX;
  const submit = () => {
    if (!form.dirty || !valid) return;
    onSave(next);
    onClose();
  };
  return (
    <Modal
      open
      title={S.appCenter.renameTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={!form.dirty || !valid} onClick={submit}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          size="sm"
          label={S.appCenter.folderNameLabel}
          hint={S.appCenter.folderNameHint}
          value={form.draft}
          maxLength={FOLDER_NAME_MAX * 2}
          autoFocus
          onChange={(e) => form.setDraft(e.target.value)}
        />
      </form>
    </Modal>
  );
}
