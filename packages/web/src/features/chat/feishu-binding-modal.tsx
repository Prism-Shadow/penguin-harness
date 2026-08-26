/**
 * Feishu binding dialog (session-row "Bind to Feishu…"): a Modal shell over the shared
 * binding editor — the same hook + body the conversation's Messaging dock panel renders,
 * so the sidebar can manage a binding without opening the chat and the two surfaces can
 * never drift. This host contributes only the Modal frame, the footer's Unbind / Close /
 * Save placement, and the unbind confirmation; every behavior (save/enable split, masked
 * secret, status poll) lives in the editor.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { FeishuBindingBody, useFeishuBinding } from "./feishu-binding-editor";

export function FeishuBindingModal({
  sessionId,
  onClose,
  onChanged,
}: {
  sessionId: string;
  onClose: () => void;
  /** Fired after a save/unbind changed whether the Session is bound (callers refresh their row/list). */
  onChanged?: (sessionId: string, bound: boolean) => void;
}) {
  // The dialog polls for its whole lifetime (it unmounts on close).
  const b = useFeishuBinding(sessionId, {
    poll: true,
    ...(onChanged ? { onChanged } : {}),
    onLoadFailed: onClose,
  });
  const [unbinding, setUnbinding] = useState(false);

  const confirmUnbind = async () => {
    if (await b.unbind()) {
      setUnbinding(false);
      onClose();
    }
  };

  return (
    <>
      <Modal
        open
        title={S.feishu.dialogTitle}
        onClose={onClose}
        footer={
          <>
            {b.hasStored && (
              <Button variant="danger" disabled={b.busy} onClick={() => setUnbinding(true)}>
                {S.feishu.unbind}
              </Button>
            )}
            <Button onClick={onClose}>{S.common.close}</Button>
            <Button
              variant="primary"
              disabled={b.busy || b.form === null}
              onClick={() => void b.save()}
            >
              {b.busy ? S.common.saving : S.common.save}
            </Button>
          </>
        }
      >
        <FeishuBindingBody b={b} />
      </Modal>

      <ConfirmModal
        open={unbinding}
        title={S.feishu.unbindConfirmTitle}
        busy={b.busy}
        onClose={() => setUnbinding(false)}
        onConfirm={() => void confirmUnbind()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.feishu.unbindConfirmBody}</p>
      </ConfirmModal>
    </>
  );
}
