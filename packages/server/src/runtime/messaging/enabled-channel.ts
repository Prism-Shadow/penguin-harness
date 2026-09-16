/**
 * The channel a Session's ENABLED messaging binding connects, or null when none is enabled —
 * the one reading behind every row mark that says "this Session relays to a bot": the
 * development list's `SessionInfo.messagingChannel` and the company sidebar's
 * `OrgDeskItem.messagingChannel`. A saved-but-disabled config marks nothing, and neither does
 * a discriminator this reading does not name.
 */
import type { MessagingChannel } from "../../api/types.js";
import type { MessagingBindings } from "../../mechanisms/messaging.js";

export function enabledMessagingChannel(
  bindings: Pick<MessagingBindings, "findEnabled">,
  sessionId: string,
): MessagingChannel | null {
  const enabled = bindings.findEnabled(sessionId);
  return enabled !== null &&
    (enabled.channel === "feishu" || enabled.channel === "telegram" || enabled.channel === "qq")
    ? enabled.channel
    : null;
}
