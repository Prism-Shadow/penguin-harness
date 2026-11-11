/**
 * A failed app's error: what its last load recorded, as the compiler or the loader wrote it, in
 * a dialog that only informs. The Agent that owns the app reads the same message from its
 * folder, so the user can hand it over as it is.
 */
import { Button, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function BuildErrorDialog({
  error,
  onClose,
}: {
  /** The app's title and its recorded error (undefined when none was recorded); null: closed. */
  error: { title: string; message: string | undefined } | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={error !== null}
      title={error === null ? "" : S.appCenter.errorTitle(error.title)}
      onClose={onClose}
      widthClass="sm:max-w-xl"
      footer={
        <Button size="sm" onClick={onClose}>
          {S.common.close}
        </Button>
      }
    >
      {error?.message === undefined ? (
        <p className="text-sm text-fg-muted">{S.appCenter.errorUnknown}</p>
      ) : (
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-fg">
          {error.message}
        </pre>
      )}
    </Modal>
  );
}
