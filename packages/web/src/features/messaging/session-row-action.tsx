/**
 * Messaging on the session list's rows (`SessionListModule.rowActions`): the row menu's
 * "Messaging binding…" entry, which opens the binding dialog on that conversation, and the paper
 * plane a relayed conversation's row wears, named by its channel.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { RowAction } from "../../lib/session-row-contributions";
import { useSessions } from "../../state/sessions";
import { MessagingBindingModal } from "./messaging-binding-modal";

/** The binding dialog: the row's mark updates in place from the dialog's own save/unbind outcome. */
function BindingDialog({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const { sessions, replace } = useSessions();
  return (
    <MessagingBindingModal
      sessionId={session.sessionId}
      onClose={onClose}
      onChanged={(sessionId, channel) => {
        const current = sessions.find((x) => x.sessionId === sessionId);
        if (!current) return;
        const updated = { ...current };
        if (channel !== null) updated.messagingChannel = channel;
        else delete updated.messagingChannel;
        replace(updated);
      }}
    />
  );
}

/** The relay mark: the channel a conversation is relayed to, or null. */
const relayLabel = (s: SessionInfo): string | null =>
  s.messagingChannel !== undefined ? S.messaging.enabledIndicator[s.messagingChannel] : null;

export const messagingRowAction: RowAction = {
  // Same paper plane as the mark it produces: the menu entry and the mark are one feature.
  sessionEntry: {
    id: "messaging",
    label: () => S.messaging.bindAction,
    icon: "paperPlane",
    Dialog: BindingDialog,
  },
  sessionMark: { kind: "relay", useLabel: () => relayLabel },
};
