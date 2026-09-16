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
 * clear checkbox.
 */
import type { MessagingChannel } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import {
  MessagingBindingBody,
  MessagingBindingHelp,
  useMessagingBinding,
} from "./messaging-binding-editor";

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

  return (
    <Modal
      open
      title={S.messaging.dialogTitle}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.close}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={b.busy || b.form === null}
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
