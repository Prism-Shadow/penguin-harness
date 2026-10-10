/**
 * Messaging binding dialog (session-row "Messaging binding…"): a Modal shell over the
 * shared channel-aware binding editor — the same hook + body the conversation's Messaging
 * dock panel renders, so the sidebar can manage bindings without opening the chat and
 * the two surfaces can never drift. This host contributes only the Modal frame, the
 * footer's Close / Save placement, the FAQ folds' position at the body's end, and the choice
 * to close on a failed load (optionally telling the host first, so a host that opened the
 * dialog from a cached row can re-read that cache); every behavior (channel switching,
 * save/enable split, single-enabled gating, models-style secret clearing, status poll) lives
 * in the editor. There is no unbind action — removing a credential is the secret field's
 * clear checkbox. Closing (the footer's Close, Esc, the ×, the backdrop) with unsaved edits on
 * any channel's form asks to discard them first, through the app's one prompt; nothing closes it
 * while a save is in flight, and a failed load closes without asking. The dialog's edits are
 * registered under a scope of their own, apart from the conversation's dock panel, so neither
 * asks about the other's.
 */
import type { MessagingChannel } from "@prismshadow/penguin-server/api";
import { Button, Modal, useGuardedClose, useUnsavedChanges } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  MessagingBindingBody,
  MessagingBindingHelp,
  useMessagingBinding,
} from "./messaging-binding-editor";

/** The dialog's edits: what its close asks about. */
const MESSAGING_DIALOG_SCOPE = "messaging-dialog";

export function MessagingBindingModal({
  sessionId,
  onClose,
  onChanged,
  onLoadFailed,
}: {
  sessionId: string;
  onClose: () => void;
  /** Fired when the ENABLED channel changed (null = none); callers refresh their row/list indicator. */
  onChanged?: (sessionId: string, channel: MessagingChannel | null) => void;
  /**
   * The binding could not be read at all — the Session is gone, or the reader lost access to
   * it. The editor has already shown the reason as a toast and this dialog closes either way;
   * a host whose row came from its own cache uses this to re-read that cache.
   */
  onLoadFailed?: () => void;
}) {
  // The dialog polls for its whole lifetime (it unmounts on close).
  const b = useMessagingBinding(sessionId, {
    poll: true,
    ...(onChanged ? { onChanged } : {}),
    onLoadFailed: () => {
      onLoadFailed?.();
      onClose();
    },
  });
  useUnsavedChanges(b.unsavedAny, { scope: MESSAGING_DIALOG_SCOPE, discard: b.discard });
  const requestClose = useGuardedClose(onClose, MESSAGING_DIALOG_SCOPE, { locked: b.busy });

  return (
    <Modal
      open
      title={S.messaging.dialogTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" disabled={b.busy} onClick={requestClose}>
            {S.common.close}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={b.busy || !b.dirty || !b.valid}
            onClick={() => void b.save()}
          >
            {b.busy ? S.common.saving : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <MessagingBindingBody b={b} />
        {/* The Save action lives in the footer; the collapsed FAQ trails the body. */}
        {b.form !== null && <MessagingBindingHelp channel={b.form.channel} />}
      </div>
    </Modal>
  );
}
