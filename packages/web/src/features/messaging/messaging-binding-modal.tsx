/**
 * Messaging binding dialog (session-row "Messaging binding…"): a Modal shell over the
 * shared channel-aware binding editor — the same hook + body the conversation's Messaging
 * dock panel renders, so the sidebar can manage bindings without opening the chat and
 * the two surfaces can never drift. This host contributes only the Modal frame, the
 * footer's Close / Save placement, and the FAQ folds' position at the body's end; every
 * behavior (channel switching, save/enable split, single-enabled gating, models-style
 * secret clearing, status poll) lives in the editor. There is no unbind action —
 * removing a credential is the secret field's clear checkbox.
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
}: {
  sessionId: string;
  onClose: () => void;
  /** Fired when the ENABLED channel changed (null = none); callers refresh their row/list indicator. */
  onChanged?: (sessionId: string, channel: MessagingChannel | null) => void;
}) {
  // The dialog polls for its whole lifetime (it unmounts on close).
  const b = useMessagingBinding(sessionId, {
    poll: true,
    ...(onChanged ? { onChanged } : {}),
    onLoadFailed: onClose,
  });

  return (
    <Modal
      open
      title={S.messaging.dialogTitle}
      onClose={onClose}
      footer={
        <>
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
      <div className="space-y-3">
        <MessagingBindingBody b={b} />
        {/* The Save action lives in the footer; the collapsed FAQ trails the body. */}
        {b.form !== null && <MessagingBindingHelp channel={b.form.channel} />}
      </div>
    </Modal>
  );
}
